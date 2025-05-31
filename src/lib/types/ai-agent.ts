// Minimal AI Agent Types for Zoiner
// Streamlined types for simplified agent without user profiles

export interface AgentDecision {
  action: 'create_token' | 'encourage' | 'help' | 'clarify' | 'celebrate';
  message: string;
  suggested_name?: string;
  suggested_symbol?: string;
  metadata_description?: string;
}

export interface ImageAnalysis {
  id?: number;
  image_url: string;
  analysis_result: string;
  artistic_style: string;
  color_palette: string[];
  mood: string;
  composition_notes: string;
  suggested_names: string[];
  suggested_symbols: string[];
  artistic_elements: string[];
  visual_description: string;
  created_at?: string;
}

// Simplified conversation type (just what we store/retrieve)
export interface Conversation {
  id?: number;
  fid: number;
  cast_hash: string;
  user_message: string;
  agent_response: string;
  image_url?: string;
  image_analysis_id?: number;
  action_taken: string;
  created_at?: string;
}

// Simplified user context (no profiles, just recent activity)
export interface UserContext {
  fid: number;
  recent_conversations: Array<{
    user_message: string;
    agent_response: string;
    action_taken: string;
    created_at: string;
  }>;
  creation_count: number; // Count from ai_token_creations table
}

// Token creation record
export interface AITokenCreation {
  id?: number;
  fid: number;
  conversation_id?: number;
  token_address: string;
  token_name: string;
  token_symbol: string;
  image_url: string;
  image_analysis_id?: number;
  ai_generated_description: string;
  user_prompt: string;
  zora_url?: string;
  transaction_hash?: string;
  created_at?: string;
}

// Claude API integration types
export interface ClaudeImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface ClaudeTextContent {
  type: 'text';
  text: string;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: (ClaudeTextContent | ClaudeImageContent)[];
}

export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
} 