import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { PublicClient, WalletClient } from 'viem';

import { createNeynarBotService } from '~/lib/neynar-bot';
import { createZoraService } from '~/lib/zora';
import { BotService } from '~/lib/bot-service';
import { ZoinerWebhookEvent } from '~/lib/types/zoiner';

// Webhook verification for GET requests
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('challenge');
  
  if (challenge) {
    return NextResponse.json({ challenge });
  }
  
  return NextResponse.json({ status: 'Zoiner webhook endpoint active' });
}

// Main webhook handler for POST requests
export async function POST(request: NextRequest) {
  console.log('🔔 Received Zoiner webhook event');
  
  try {
    // Parse the webhook event
    const event = await request.json() as ZoinerWebhookEvent;
    console.log('Webhook event type:', event.type);
    
    // Only process cast.created events
    if (event.type !== 'cast.created') {
      console.log(`⏭️ Ignoring event type: ${event.type}`);
      return NextResponse.json({ status: 'ok' });
    }
    
    const castHash = event.data.hash;
    console.log(`📝 Processing cast.created event for cast ${castHash}`);
    
    // Initialize services
    const botService = await initializeBotService();
    if (!botService) {
      console.error('❌ Failed to initialize bot service');
      return NextResponse.json({ 
        status: 'error', 
        message: 'Bot service initialization failed' 
      }, { status: 500 });
    }
    
    // Process the cast asynchronously to not block the webhook response
    botService.processCast(castHash).catch(err => {
      console.error(`❌ Error processing cast ${castHash}:`, err);
    });
    
    // Always return 200 OK for webhook events
    return NextResponse.json({ status: 'ok' });
    
  } catch (error) {
    console.error('❌ Error handling webhook event:', error);
    return NextResponse.json({ 
      status: 'error', 
      message: 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * Initialize the bot service with all required dependencies
 * @returns BotService instance or null if initialization fails
 */
async function initializeBotService(): Promise<BotService | null> {
  try {
    // Check required environment variables
    const walletPrivateKey = process.env.WALLET_PRIVATE_KEY;
    if (!walletPrivateKey) {
      console.error('❌ WALLET_PRIVATE_KEY is required');
      return null;
    }
    
    // Create the wallet account
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
    
    // Create and return bot service
    return new BotService(neynarService, zoraService);
    
  } catch (error) {
    console.error('❌ Error initializing bot service:', error);
    return null;
  }
} 