export const APP_URL = process.env.NEXT_PUBLIC_URL!;
export const APP_NAME = process.env.NEXT_PUBLIC_FRAME_NAME;
export const APP_DESCRIPTION = process.env.NEXT_PUBLIC_FRAME_DESCRIPTION;
export const APP_PRIMARY_CATEGORY = process.env.NEXT_PUBLIC_FRAME_PRIMARY_CATEGORY;
export const APP_TAGS = process.env.NEXT_PUBLIC_FRAME_TAGS?.split(',');
export const APP_ICON_URL = `${APP_URL}/icon.png`;
export const APP_OG_IMAGE_URL = `${APP_URL}/api/opengraph-image`;
export const APP_SPLASH_URL = `${APP_URL}/splash.png`;
export const APP_SPLASH_BACKGROUND_COLOR = "#f7f7f7";
export const APP_BUTTON_TEXT = process.env.NEXT_PUBLIC_FRAME_BUTTON_TEXT;
export const APP_WEBHOOK_URL = process.env.NEYNAR_API_KEY && process.env.NEYNAR_CLIENT_ID 
    ? `https://api.neynar.com/f/app/${process.env.NEYNAR_CLIENT_ID}/event`
    : `${APP_URL}/api/webhook`;

// Zoiner Bot Constants
export const BOT_FID = process.env.BOT_FID;
export const BOT_NAME = process.env.BOT_NAME || 'zoiner';
export const SIGNER_UUID = process.env.SIGNER_UUID;
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
export const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';
export const DRY_RUN = process.env.DRY_RUN === 'true';

// AI Agent Constants
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
export const AI_MODEL = process.env.AI_MODEL || 'claude-3-5-sonnet-20241022';
export const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1000');

// Pinata/IPFS Constants
export const PINATA_JWT = process.env.PINATA_JWT;
export const GATEWAY_URL = process.env.GATEWAY_URL || 'tan-obvious-puffin-912.mypinata.cloud';

// API Configuration
export const API_ENDPOINT = process.env.API_ENDPOINT || APP_URL;
export const ZOINER_WEBHOOK_URL = `${APP_URL}/api/zoiner/webhook`;
export const ZOINER_METADATA_URL = `${APP_URL}/api/zoiner/metadata`;
