import { FarcasterCast } from './types/zoiner';
import { uploadImageUrlToIPFS } from './ipfs-utils';

/**
 * Extract image URL from a Farcaster cast
 * @param cast The Farcaster cast object
 * @returns The best image URL found, or null if none
 */
export async function extractImageFromCast(cast: FarcasterCast): Promise<string | null> {
  console.log(`Extracting image from cast ${cast.hash}`);
  
  // Debug log the entire cast structure
  console.log('CAST STRUCTURE:', JSON.stringify({
    has_embeds: Boolean(cast.embeds?.length),
    embeds_count: cast.embeds?.length || 0,
    embedded_media_count: cast.embedded_media?.length || 0,
    image_urls_count: cast.image_urls?.length || 0,
    images_count: cast.images?.length || 0
  }));
  
  // Log specific image-related fields
  if (cast.embeds && cast.embeds.length > 0) {
    console.log(`Found ${cast.embeds.length} embeds:`, JSON.stringify(cast.embeds, null, 2));
  }
  
  // Check embeds first (this is the most common format in the new API)
  if (cast.embeds && cast.embeds.length > 0) {
    for (const embed of cast.embeds) {
      console.log(`Checking embed:`, JSON.stringify(embed));
      
      // Check if embed has an image URL
      if (embed.url) {
        // Check if metadata identifies this as an image
        if (embed.mimetype?.startsWith('image/')) {
          console.log(`Found image in embed with mimetype: ${embed.mimetype}`);
          return embed.url; // Return directly as this is the most reliable image source
        }
        
        // No metadata or content type? Check the URL directly
        if (isLikelyImageUrl(embed.url)) {
          console.log(`Found likely image URL in embed: ${embed.url}`);
          return embed.url;
        }
      }
      
      // Check if embed has explicit image property
      if (embed.image) {
        console.log(`Found image directly in embed.image: ${embed.image}`);
        return embed.image;
      }
    }
  }
  
  // Check embedded media (older format)
  if (cast.embedded_media && cast.embedded_media.length > 0) {
    console.log(`Found ${cast.embedded_media.length} embedded_media items`);
    
    for (const media of cast.embedded_media) {
      if (media.url) {
        if (media.type?.startsWith('image/')) {
          console.log(`Found image in embedded_media with type: ${media.type}`);
          return media.url;
        }
        
        if (isLikelyImageUrl(media.url)) {
          console.log(`Found likely image URL in embedded_media: ${media.url}`);
          return media.url;
        }
      }
    }
  }
  
  // Check image_urls array (sometimes provided directly)
  if (cast.image_urls && cast.image_urls.length > 0) {
    console.log(`Found ${cast.image_urls.length} image_urls`);
    return cast.image_urls[0]; // Just use the first one
  }
  
  // Check images array (sometimes provided directly)
  if (cast.images && cast.images.length > 0) {
    console.log(`Found ${cast.images.length} images`);
    return cast.images[0]; // Just use the first one
  }
  
  // If we reach here, no image was found
  console.warn('No valid image found in the cast');
  return null;
}

/**
 * Determine if a URL is likely to be an image based on extension
 * @param url URL to check
 * @returns True if the URL is likely an image
 */
function isLikelyImageUrl(url: string): boolean {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  const lowercaseUrl = url.toLowerCase();
  
  return imageExtensions.some(ext => lowercaseUrl.endsWith(ext) || lowercaseUrl.includes('image'));
}

/**
 * Upload an image to IPFS via Pinata
 * @param imageUrl The URL of the image to upload
 * @returns The IPFS URI of the uploaded image or the original URL if upload fails
 */
async function uploadImageToIPFS(imageUrl: string): Promise<string> {
  try {
    console.log(`Uploading image to IPFS: ${imageUrl}`);
    
    // If we're in dry run mode, just return the original URL
    if (process.env.DRY_RUN === 'true') {
      console.log('🏜️ DRY RUN: Skipping IPFS upload, returning original URL');
      return imageUrl;
    }
    
    // Use the shared uploadImageUrlToIPFS function from ipfs-utils.ts
    return await uploadImageUrlToIPFS(imageUrl);
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error handling image:', errorMessage);
    console.log('Falling back to original image URL');
    return imageUrl;
  }
}

/**
 * Convert an image URL to a data URI format if needed for Zora
 * @param imageUrl The image URL to process
 * @returns Promise resolving to the processed image URL (as-is for now)
 */
export async function prepareImageForZora(imageUrl: string): Promise<string> {
  // Try to upload to IPFS first
  try {
    return await uploadImageToIPFS(imageUrl);
  } catch {
    console.warn('Failed to upload to IPFS, using original URL');
    return imageUrl;
  }
} 