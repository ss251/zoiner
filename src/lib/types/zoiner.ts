import { Address } from 'viem';

// Types for Farcaster casts and data
export interface FarcasterCast {
  hash: string;
  thread_hash?: string;
  parent_hash?: string;
  author: FarcasterUser;
  text: string;
  timestamp: string;
  embeds?: {
    url?: string;
    title?: string;
    description?: string;
    image?: string;
    mimetype?: string;
  }[];
  mentions?: number[];
  mentions_positions?: number[];
  parent_url?: string;
  embedded_media?: {
    url?: string;
    type?: string;
    alt_text?: string;
  }[];
  image_urls?: string[];
  // Additional fields observed from API responses
  attachments?: Array<string | { url: string; type?: string }>;
  frames?: unknown[];
  media?: unknown[];
  images?: string[];
}

export interface FarcasterUser {
  fid: number;
  username: string;
  display_name: string;
  pfp_url?: string;
  verifications: {
    ethereum?: string;
    solana?: string;
  };
  profile?: unknown;
}

// Types for Zora metadata (EIP-7572 standard)
export interface ZoraMetadata {
  name: string;
  description: string;
  symbol?: string;
  image: string;
  animation_url?: string;
  content?: {
    uri: string;
    mime: string;
  };
  properties: {
    category: string;
    [key: string]: unknown;
  };
}

// Types for Zora coin creation
export interface CoinCreationParams {
  name: string;
  symbol: string;
  uri: string;
  payoutRecipient: Address;
  platformReferrer?: Address;
  initialPurchaseWei?: bigint;
}

export interface CoinCreationResult {
  hash: `0x${string}`;
  address: `0x${string}`;
  deployment: unknown;
}

// Types for webhook events
export interface ZoinerWebhookEvent {
  created_at: number;
  type: string;
  data: {
    hash: string;
    [key: string]: unknown;
  };
}

// Types for parsing coin creation requests
export interface CoinCreationRequest {
  name: string;
  symbol: string;
  imageUrl: string;
  creatorAddress: `0x${string}`;
} 