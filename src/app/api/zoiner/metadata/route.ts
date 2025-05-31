import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Get the metadata values from query parameters or use defaults
    const name = searchParams.get('name');
    const symbol = searchParams.get('symbol');
    const image = searchParams.get('image');
    
    // Generate metadata with the parameters or fall back to defaults
    const metadata = {
      name: name,
      description: (name) + " - Created with @zoiner on Farcaster",
      symbol: symbol,
      image: image,
      properties: {
        category: "social"
      }
    };
    
    // Set the content type to application/json
    return NextResponse.json(metadata, {
      headers: {
        'Content-Type': 'application/json',
        // Add CORS headers for cross-origin requests
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('Error generating metadata:', error);
    return NextResponse.json(
      { error: 'Failed to generate metadata' },
      { status: 500 }
    );
  }
} 