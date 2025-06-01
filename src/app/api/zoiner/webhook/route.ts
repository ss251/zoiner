import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { PublicClient, WalletClient } from 'viem';

import { createNeynarBotService } from '~/lib/neynar-bot';
import { createZoraService } from '~/lib/zora';
import { AIBotService } from '~/lib/ai-bot-service';
import { ZoinerWebhookEvent } from '~/lib/types/zoiner';

// Global cooldown map to prevent rapid-fire processing
const processingCooldown = new Map<string, number>();
const COOLDOWN_MS = 30000; // 30 seconds between processing same user

// Webhook verification for GET requests
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('challenge');
  
  if (challenge) {
    return NextResponse.json({ challenge });
  }
  
  return NextResponse.json({ 
    status: 'Zoiner AI Agent webhook endpoint active',
    version: '2.0.0-ai',
    capabilities: ['claude-vision', 'context-aware', 'creative-catalyst', 'auto-cleanup']
  });
}

// Main webhook handler for POST requests
export async function POST(request: NextRequest) {
  console.log('🎨 Received Zoiner AI Agent webhook event');
  
  try {
    // Parse the webhook event
    const event = await request.json() as ZoinerWebhookEvent;
    console.log('Webhook event type:', event.type);
    
    // Only process cast.created events
    if (event.type !== 'cast.created') {
      console.log(`⏭️ Ignoring event type: ${event.type}`);
      return NextResponse.json({ status: 'ok', reason: 'ignored_event_type' });
    }
    
    const castHash = event.data.hash;
    console.log(`📝 Processing cast.created event for cast ${castHash}`);
    
    // Quick check for cooldown before expensive initialization
    const now = Date.now();
    const lastProcessed = processingCooldown.get(castHash);
    if (lastProcessed && (now - lastProcessed) < COOLDOWN_MS) {
      console.log(`⏱️ Cast ${castHash} is in cooldown period, skipping`);
      return NextResponse.json({ 
        status: 'ok', 
        reason: 'cooldown_active',
        cast_hash: castHash 
      });
    }
    
    // Set cooldown immediately
    processingCooldown.set(castHash, now);
    
    // Clean up old cooldown entries (older than 1 hour)
    const hourAgo = now - (60 * 60 * 1000);
    for (const [hash, timestamp] of processingCooldown.entries()) {
      if (timestamp < hourAgo) {
        processingCooldown.delete(hash);
      }
    }
    
    // Initialize AI-powered bot service
    const aiBotService = await initializeAIBotService();
    if (!aiBotService) {
      console.error('❌ Failed to initialize AI bot service');
      return NextResponse.json({ 
        status: 'error', 
        message: 'AI bot service initialization failed' 
      }, { status: 500 });
    }
    
    // Process the cast with full error handling
    try {
      await aiBotService.processCast(castHash);
      console.log('✅ AI agent processing completed successfully');
      
      return NextResponse.json({ 
        status: 'completed',
        message: 'AI agent processing completed',
        cast_hash: castHash
      });
    } catch (processingError) {
      console.error(`❌ Error processing cast ${castHash}:`, processingError);
      
      // Remove from cooldown on error so it can be retried
      processingCooldown.delete(castHash);
      
      // Still return 200 OK to webhook, but log the error
      return NextResponse.json({ 
        status: 'error',
        message: 'AI agent processing failed',
        cast_hash: castHash,
        error: processingError instanceof Error ? processingError.message : 'Unknown error'
      });
    }
    
  } catch (error) {
    console.error('❌ Error handling webhook event:', error);
    return NextResponse.json({ 
      status: 'error', 
      message: 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * Initialize the AI-powered bot service with all required dependencies
 * @returns AIBotService instance or null if initialization fails
 */
async function initializeAIBotService(): Promise<AIBotService | null> {
  try {
    console.log('🤖 Initializing AI bot service...');
    
    // Check required environment variables for AI functionality
    const requiredEnvVars = [
      'WALLET_PRIVATE_KEY',
      'NEYNAR_API_KEY', 
      'SIGNER_UUID',
      'BOT_FID',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingVars);
      return null;
    }
    
    // Check for Claude/Anthropic API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('⚠️ ANTHROPIC_API_KEY not set - falling back to pattern matching mode');
    }
    
    // Create the wallet account
    const walletPrivateKey = process.env.WALLET_PRIVATE_KEY;
    const account = privateKeyToAccount(walletPrivateKey as `0x${string}`);
    
    // Create viem clients for Zora service
    const publicClient = createPublicClient({
      chain: base,
      transport: http(process.env.RPC_URL || 'https://mainnet.base.org')
    }) as PublicClient;
    
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(process.env.RPC_URL || 'https://mainnet.base.org')
    }) as WalletClient;
    
    // Create Neynar service
    const neynarService = createNeynarBotService();
    if (!neynarService) {
      console.error('❌ Failed to create Neynar service');
      return null;
    }
    
    // Create Zora service
    const zoraService = createZoraService(walletClient, publicClient);
    
    // Create and return AI bot service
    const aiBotService = new AIBotService(neynarService, zoraService);
    
    console.log('✅ AI bot service initialized successfully');
    console.log('🎨 Zoiner AI Agent ready - creative catalyst mode activated!');
    
    return aiBotService;
    
  } catch (error) {
    console.error('❌ Error initializing AI bot service:', error);
    return null;
  }
} 