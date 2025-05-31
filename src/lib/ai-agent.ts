import { createClient, SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import { 
  AgentDecision, 
  ImageAnalysis,
  ClaudeMessage,
  ClaudeResponse,
} from './types/ai-agent';
import { FarcasterCast } from './types/zoiner';
import { NeynarBotService } from './neynar-bot';
import { ZoraService } from './zora';
import { extractImageFromCast } from './image-utils';
import { isRequestToCoinCast } from './cast-utils';
import { OGImageService } from './og-image-service';
import { ZOINER_PLATFORM_ADDRESS } from './constants';

// Simplified user context without profiles
interface UserContext {
  fid: number;
  recent_conversations: Array<{
    user_message: string;
    agent_response: string;
    action_taken: string;
    created_at: string;
  }>;
  creation_count: number; // Count from ai_token_creations table
}

const ZOINER_PERSONALITY_PROMPT = `You are Zoiner, a creative AI that helps artists turn their images into Zora ERC20 tokens on Farcaster.

PERSONALITY TRAITS:
- Creative catalyst who celebrates all forms of art
- Encouraging and supportive, never judgmental  
- Uses artistic language and visual metaphors
- Catchphrase: "your creation is zoined!" for successful tokens
- Focus on artistic vision over technical details

CAPABILITIES:
- Analyze images to understand artistic elements
- Suggest creative token names based on visual content
- Guide users through token creation process
- Create tokens from cast previews when users say "coin this cast"
- Celebrate successful creations enthusiastically

DECISION FRAMEWORK:
1. If user mentions you with an image: Analyze art and offer to tokenize
2. If user says "coin this cast": Create token using cast preview as image
3. If user requests token creation: Extract name/symbol or suggest based on image
4. If user needs help: Provide encouraging, art-focused guidance
5. If unclear intent: Ask clarifying questions about their creative vision

RESPONSE FORMAT:
Always respond with JSON:
{
  "message": "your encouraging response text",
  "action": "create_token" | "create_cast_token" | "clarify" | "help" | "encourage" | "celebrate",
  "suggested_name": "if action is create_token or create_cast_token",
  "suggested_symbol": "if action is create_token or create_cast_token", 
  "metadata_description": "artistic description for token metadata"
}

Remember: You're helping artists express their creativity onchain. Be enthusiastic, supportive, and focus on the artistic journey!`;

export class ZoinerAgentService {
  private supabase: SupabaseClient;

  constructor(
    private neynarService: NeynarBotService,
    private zoraService: ZoraService
  ) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async processInteraction(cast: FarcasterCast): Promise<void> {
    console.group(`🎨 AI Agent processing interaction from FID ${cast.author.fid}`);
    
    try {
      // Check if this is a "coin this cast" request
      const isCastTokenRequest = isRequestToCoinCast(cast.text);
      
      if (isCastTokenRequest) {
        // Handle "coin this cast" requests
        await this.processCastTokenRequest(cast);
      } else {
        // Handle regular image token creation (existing flow)
        await this.processRegularTokenRequest(cast);
      }

    } catch (error) {
      console.error('❌ Error in AI agent processing:', error);
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        "sorry, i'm having a creative block right now! 🎨 try again in a moment ✨"
      );
    } finally {
      console.groupEnd();
    }
  }

  /**
   * Handle "coin this cast" requests - new functionality
   */
  private async processCastTokenRequest(cast: FarcasterCast): Promise<void> {
    let targetCast = cast;

    // If this is a reply, fetch the parent cast to tokenize
    if (cast.parent_hash) {
      console.log('🔗 This is a reply - fetching parent cast for tokenization');
      try {
        const parentCast = await this.neynarService.getCastByHash(cast.parent_hash);
        if (parentCast) {
          targetCast = parentCast;
          console.log(`📄 Using parent cast from ${parentCast.author.username} for tokenization`);
        }
      } catch (error) {
        console.error('❌ Error fetching parent cast:', error);
      }
    }

    // Generate OG image URL (no Claude analysis needed)
    console.log('🖼️ Generating OG image for cast tokenization');
    const imageUrl = OGImageService.generateCastImageUrl(targetCast);
    console.log(`📸 Generated OG image URL: ${imageUrl}`);

    // Analyze cast content for meaningful token naming
    console.log('🤖 Analyzing cast content for token naming');
    const tokenInfo = await this.analyzeCastForTokenCreation(targetCast);
    console.log(`💡 Generated token: "${tokenInfo.name}" (${tokenInfo.symbol})`);

    // Create token directly
    await this.executeCastTokenCreation(
      {
        action: 'create_cast_token',
        message: 'turning this cast into a token! 🎨→🪙',
        suggested_name: tokenInfo.name,
        suggested_symbol: tokenInfo.symbol,
        metadata_description: tokenInfo.description
      },
      cast,
      imageUrl,
      targetCast
    );
  }

  /**
   * Handle regular image token creation - existing functionality
   */
  private async processRegularTokenRequest(cast: FarcasterCast): Promise<void> {
    // 1. Analyze image if present
    const imageUrl = await extractImageFromCast(cast);
    const imageAnalysis = imageUrl ? await this.analyzeImage(imageUrl) : null;

    // 2. Get minimal user context (just recent conversations)
    const userContext = await this.getUserContext(cast.author.fid);

    // 3. AI decision
    const decision = await this.makeRegularDecision(cast, imageAnalysis, userContext);

    // 4. Execute decision
    if (decision.action === 'create_token') {
      await this.executeTokenCreation(decision, cast, imageAnalysis);
    } else {
      await this.neynarService.replyToCast(cast.author.fid, cast.hash, decision.message);
    }

    // 5. Store conversation
    await this.storeConversation(cast, decision, imageAnalysis);
  }

  private async getUserContext(fid: number): Promise<UserContext> {
    // Get recent conversations (last 5)
    const { data: conversations } = await this.supabase
      .from('conversations')
      .select('user_message, agent_response, action_taken, created_at')
      .eq('fid', fid)
      .order('created_at', { ascending: false })
      .limit(5);

    // Count token creations
    const { count } = await this.supabase
      .from('ai_token_creations')
      .select('*', { count: 'exact', head: true })
      .eq('fid', fid);

    return {
      fid,
      recent_conversations: conversations || [],
      creation_count: count || 0
    };
  }

  private async analyzeImage(imageUrl: string): Promise<ImageAnalysis> {
    // Check cache first
    const { data: cached } = await this.supabase
      .from('image_analyses')
      .select('*')
      .eq('image_url', imageUrl)
      .single();

    if (cached) {
      console.log('✅ Using cached image analysis');
      return cached as ImageAnalysis;
    }

    // Analyze with Claude Vision
    const imageBase64 = await this.downloadImageAsBase64(imageUrl);
    const analysis = await this.callClaude([{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: this.getImageMimeType(imageUrl),
            data: imageBase64
          }
        },
        {
          type: 'text',
          text: `Analyze this image for token creation. Respond with JSON:
          {
            "artistic_style": "describe the art style",
            "color_palette": ["dominant", "colors"],
            "mood": "emotional tone",
            "composition_notes": "visual details",
            "suggested_names": ["Creative", "Names"],
            "suggested_symbols": ["SYM", "BOL"],
            "artistic_elements": ["key", "elements"],
            "visual_description": "detailed description"
          }`
        }
      ]
    }], 'You are an AI art critic helping with token creation.');

    let parsedAnalysis;
    try {
      parsedAnalysis = JSON.parse(analysis);
    } catch {
      parsedAnalysis = {
        artistic_style: 'digital art',
        color_palette: ['vibrant'],
        mood: 'creative',
        composition_notes: 'balanced composition',
        suggested_names: ['Creative Vision'],
        suggested_symbols: ['VISION'],
        artistic_elements: ['digital art'],
        visual_description: 'A creative digital work'
      };
    }

    // Cache analysis
    const { data: inserted } = await this.supabase
      .from('image_analyses')
      .insert({
        image_url: imageUrl,
        analysis_result: analysis,
        ...parsedAnalysis
      })
      .select()
      .single();

    return inserted as ImageAnalysis;
  }

  private async makeRegularDecision(
    cast: FarcasterCast, 
    imageAnalysis: ImageAnalysis | null, 
    userContext: UserContext
  ): Promise<AgentDecision> {
    const contextText = this.buildContextText(cast, imageAnalysis, userContext);
    const response = await this.callClaude([{
      role: 'user',
      content: [{ type: 'text', text: contextText }]
    }], ZOINER_PERSONALITY_PROMPT);

    try {
      return JSON.parse(response) as AgentDecision;
    } catch {
      // Fallback decision for regular image token creation
      const text = cast.text.toLowerCase();
      const hasImage = imageAnalysis !== null;

      if (hasImage && (text.includes('coin') || text.includes('token'))) {
        return {
          action: 'create_token',
          message: 'creating your token now! 🎨→🪙',
          suggested_name: imageAnalysis?.suggested_names[0] || 'Creative Vision',
          suggested_symbol: imageAnalysis?.suggested_symbols[0] || 'CREATE',
          metadata_description: imageAnalysis?.visual_description || 'A creative work'
        };
      }

      return {
        action: hasImage ? 'encourage' : 'help',
        message: hasImage 
          ? 'beautiful work! 🎨 want to turn this into a token?' 
          : 'hi! share an image to create a token 🎨→🪙'
      };
    }
  }

  private async executeTokenCreation(
    decision: AgentDecision,
    cast: FarcasterCast,
    imageAnalysis: ImageAnalysis | null
  ): Promise<void> {
    if (process.env.DRY_RUN === 'true') {
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        `${decision.message}\n\n🏜️ DRY RUN: Token "${decision.suggested_name}" would be created!`
      );
      return;
    }

    try {
      const creatorAddress = await this.neynarService.getUserEthereumAddress(cast.author.fid);
      const imageUrl = await extractImageFromCast(cast);
      
      if (!creatorAddress || !imageUrl) {
        await this.neynarService.replyToCast(
          cast.author.fid,
          cast.hash,
          !creatorAddress 
            ? "need a verified ethereum address first!" 
            : "need an image to create your token!"
        );
        return;
      }

      const metadataUri = await this.zoraService.buildMetadataUri(
        decision.suggested_name!,
        decision.suggested_symbol!,
        imageUrl
      );

      const result = await this.zoraService.createCoin({
        name: decision.suggested_name!,
        symbol: decision.suggested_symbol!,
        uri: metadataUri,
        payoutRecipient: creatorAddress as `0x${string}`,
        platformReferrer: ZOINER_PLATFORM_ADDRESS as `0x${string}`,
        initialPurchaseWei: 0n
      });

      const zoraUrl = this.zoraService.generateZoraUrl(result.address, ZOINER_PLATFORM_ADDRESS);
      
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        `${decision.message}\n\nyour creation is zoined! 🎨→🪙\n\n${zoraUrl}`
      );

      // Store token creation
      await this.supabase.from('ai_token_creations').insert({
        fid: cast.author.fid,
        token_address: result.address,
        token_name: decision.suggested_name!,
        token_symbol: decision.suggested_symbol!,
        image_url: imageUrl,
        image_analysis_id: imageAnalysis?.id,
        ai_generated_description: decision.metadata_description!,
        user_prompt: cast.text,
        zora_url: zoraUrl,
        transaction_hash: result.hash
      });

    } catch (error) {
      console.error('❌ Token creation failed:', error);
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        "sorry, hit a creative block! 🎨 try again ✨"
      );
    }
  }

  private async executeCastTokenCreation(
    decision: AgentDecision,
    cast: FarcasterCast,
    imageUrl: string | null,
    targetCast: FarcasterCast
  ): Promise<void> {
    if (process.env.DRY_RUN === 'true') {
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        `${decision.message}\n\n🏜️ DRY RUN: Token "${decision.suggested_name}" would be created from cast by ${targetCast.author.username}!`
      );
      return;
    }

    try {
      const creatorAddress = await this.neynarService.getUserEthereumAddress(cast.author.fid);
      
      if (!creatorAddress || !imageUrl) {
        await this.neynarService.replyToCast(
          cast.author.fid,
          cast.hash,
          !creatorAddress 
            ? "need a verified ethereum address first!" 
            : "need an image to create your token!"
        );
        return;
      }

      // Generate better token name based on target cast content
      const tokenName = decision.suggested_name || `Cast by ${targetCast.author.username}`;
      const tokenSymbol = decision.suggested_symbol || 'CAST';
      const description = decision.metadata_description || `Tokenized cast: "${targetCast.text.slice(0, 100)}${targetCast.text.length > 100 ? '...' : ''}"`;

      const metadataUri = await this.zoraService.buildMetadataUri(
        tokenName,
        tokenSymbol,
        imageUrl
      );

      const result = await this.zoraService.createCoin({
        name: tokenName,
        symbol: tokenSymbol,
        uri: metadataUri,
        payoutRecipient: creatorAddress as `0x${string}`,
        platformReferrer: ZOINER_PLATFORM_ADDRESS as `0x${string}`,
        initialPurchaseWei: 0n
      });

      const zoraUrl = this.zoraService.generateZoraUrl(result.address, ZOINER_PLATFORM_ADDRESS);
      
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        `${decision.message}\n\nyour creation is zoined! 🎨→🪙\n\ntokenized cast by @${targetCast.author.username}\n\n${zoraUrl}`
      );

      // Store token creation with target cast info
      await this.supabase.from('ai_token_creations').insert({
        fid: cast.author.fid,
        token_address: result.address,
        token_name: tokenName,
        token_symbol: tokenSymbol,
        image_url: imageUrl,
        image_analysis_id: null,
        ai_generated_description: description,
        user_prompt: cast.text,
        zora_url: zoraUrl,
        transaction_hash: result.hash
      });

    } catch (error) {
      console.error('❌ Token creation failed:', error);
      await this.neynarService.replyToCast(
        cast.author.fid,
        cast.hash,
        "sorry, hit a creative block! 🎨 try again ✨"
      );
    }
  }

  private async storeConversation(
    cast: FarcasterCast,
    decision: AgentDecision,
    imageAnalysis: ImageAnalysis | null
  ): Promise<void> {
    await this.supabase.from('conversations').insert({
      fid: cast.author.fid,
      cast_hash: cast.hash,
      user_message: cast.text,
      agent_response: decision.message,
      image_url: imageAnalysis?.image_url,
      image_analysis_id: imageAnalysis?.id,
      action_taken: decision.action
    });
  }

  // Helper methods (same as before)
  private async callClaude(messages: ClaudeMessage[], systemPrompt: string): Promise<string> {
    const response = await axios.post<ClaudeResponse>(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: systemPrompt,
        messages
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01'
        }
      }
    );
    return response.data.content[0].text;
  }

  private async downloadImageAsBase64(imageUrl: string): Promise<string> {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data).toString('base64');
  }

  private getImageMimeType(imageUrl: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    const url = imageUrl.toLowerCase();
    if (url.includes('.png')) return 'image/png';
    if (url.includes('.gif')) return 'image/gif';
    if (url.includes('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  private buildContextText(
    cast: FarcasterCast, 
    imageAnalysis: ImageAnalysis | null, 
    userContext: UserContext
  ): string {
    let context = `User message: "${cast.text}"\n`;
    
    if (imageAnalysis) {
      context += `\nImage: ${imageAnalysis.artistic_style}, ${imageAnalysis.mood}`;
      context += `\nSuggested names: ${imageAnalysis.suggested_names.join(', ')}`;
    }

    context += `\nUser has created ${userContext.creation_count} tokens`;
    
    if (userContext.recent_conversations.length > 0) {
      context += `\nRecent: ${userContext.recent_conversations[0].action_taken}`;
    }

    return context;
  }

  /**
   * Analyze cast content to generate meaningful token name and description
   */
  private async analyzeCastForTokenCreation(targetCast: FarcasterCast): Promise<{
    name: string;
    symbol: string;
    description: string;
  }> {
    try {
      // Clean up problematic Unicode characters that might break API calls
      const cleanText = targetCast.text
        .replace(/￼/g, '') // Remove object replacement characters
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
        .trim();

      console.log('🧹 Cleaned cast text:', cleanText);

      const prompt = `analyze this cast and create a token name:

"${cleanText}" by ${targetCast.author.display_name || targetCast.author.username}

make it meaningful but not cringe. capture the vibe.

respond only with:
{
  "name": "token name (2-10 words max)",
  "symbol": "symbol (3-10 letters)", 
  "description": "why this cast matters (1-2 sentences)"
}

examples:
- "gm everyone" → {"name": "GM Energy", "symbol": "GM", "description": "daily dose of good morning vibes"}
- "building something cool" → {"name": "Building Cool", "symbol": "BUILD", "description": "the hustle of creating something new"}
- "coffee time" → {"name": "Coffee Time", "symbol": "BREW", "description": "fuel for the grind"}`;

      const response = await this.callClaude([{
        role: 'user',
        content: [{ type: 'text', text: prompt }]
      }], 'you create token names from social content. be concise and cool.');

      console.log('🔍 Claude response for cast analysis:', response);

      const parsed = JSON.parse(response);
      
      return {
        name: parsed.name || `${targetCast.author.display_name || targetCast.author.username} Cast`,
        symbol: parsed.symbol || 'CAST',
        description: parsed.description || `Tokenized cast: "${targetCast.text.slice(0, 100)}${targetCast.text.length > 100 ? '...' : ''}"`
      };

    } catch (error) {
      console.error('❌ Error analyzing cast content:', error);
      console.error('❌ Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        castText: targetCast.text,
        author: targetCast.author.display_name || targetCast.author.username
      });
      
      // Fallback to basic naming
      return {
        name: `${targetCast.author.display_name || targetCast.author.username} Cast`,
        symbol: 'CAST',
        description: `Tokenized cast: "${targetCast.text.slice(0, 100)}${targetCast.text.length > 100 ? '...' : ''}"`
      };
    }
  }
} 