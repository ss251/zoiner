import axios from 'axios';

export class PinataService {
  private jwt: string;
  private gatewayUrl: string;
  private apiUrl: string = 'https://api.pinata.cloud';

  constructor() {
    // Get credentials from environment
    this.jwt = process.env.PINATA_JWT || '';
    this.gatewayUrl = process.env.GATEWAY_URL || 'gateway.pinata.cloud';
    
    // Log clear message if credentials are missing
    if (!this.jwt || this.jwt.trim() === '') {
      console.error('🚨 PINATA_JWT environment variable is not set or is empty');
      console.error('Set this environment variable in your .env file:');
      console.error('PINATA_JWT=your_jwt_token_here');
    }
  }

  /**
   * Test authentication with Pinata
   * @returns Promise resolving to true if authenticated, false otherwise
   */
  async testAuthentication(): Promise<boolean> {
    // Validate JWT before attempting auth
    if (!this.jwt || this.jwt.trim() === '') {
      throw new Error('PINATA_JWT environment variable is not set. Cannot authenticate with Pinata.');
    }
    
    try {
      console.log('Testing Pinata authentication...');
      const response = await axios.get(`${this.apiUrl}/data/testAuthentication`, {
        headers: this.getAuthHeaders()
      });
      
      console.log('✅ Pinata authentication successful');
      return response.status === 200;
    } catch (error: unknown) {
      let statusCode: number | undefined;
      let errorMessage: string;
      
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response: { status: number; data?: { error?: { reason?: string } } } };
        statusCode = axiosError.response?.status;
        errorMessage = axiosError.response?.data?.error?.reason || 'Unknown error';
      } else {
        errorMessage = error instanceof Error ? error.message : 'Unknown error';
      }
      
      console.error(`❌ Pinata authentication failed: ${statusCode} - ${errorMessage}`);
      
      if (statusCode === 401) {
        console.error('🔑 Your JWT token is invalid or expired. Update your PINATA_JWT environment variable.');
      }
      
      throw new Error(`Pinata authentication failed: ${errorMessage}`);
    }
  }

  /**
   * Get common headers for Pinata API requests
   */
  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.jwt}`
    };
  }

  /**
   * Upload JSON data to IPFS
   * @param jsonBody The JSON data to upload
   * @param name Optional name for the file
   * @returns Promise resolving to the IPFS URI
   */
  async pinJSONToIPFS(jsonBody: Record<string, unknown>, name = 'metadata.json'): Promise<string> {
    // Ensure we're authenticated before trying
    await this.testAuthentication();
    
    try {
      console.log('📤 Uploading JSON to Pinata:', name);
      
      const response = await axios.post(
        `${this.apiUrl}/pinning/pinJSONToIPFS`,
        {
          pinataContent: jsonBody,
          pinataMetadata: {
            name: name
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...this.getAuthHeaders()
          }
        }
      );
      
      if (response.status === 200) {
        const ipfsHash = response.data.IpfsHash;
        const ipfsUri = `ipfs://${ipfsHash}`;
        const gatewayUrl = this.getGatewayUrl(ipfsHash);
        
        console.log(`✅ JSON pinned to IPFS with hash: ${ipfsHash}`);
        console.log(`🔗 Gateway URL: ${gatewayUrl}`);
        
        return ipfsUri;
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error: unknown) {
      let errorDetails: string;
      
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response: { data?: { error?: unknown } } };
        errorDetails = JSON.stringify(axiosError.response?.data?.error) || 'Unknown error';
      } else {
        errorDetails = error instanceof Error ? error.message : 'Unknown error';
      }
      
      console.error(`❌ Error pinning JSON to IPFS: ${errorDetails}`);
      throw new Error(`Failed to pin JSON to IPFS: ${errorDetails}`);
    }
  }

  /**
   * Upload a buffer to IPFS
   * @param fileBuffer The file buffer to upload
   * @param filename Filename to use
   * @returns Promise resolving to the IPFS URI
   */
  async pinBufferToIPFS(fileBuffer: Buffer, filename: string): Promise<string> {
    try {
      // Ensure we're authenticated before trying
      await this.testAuthentication();
      
      console.log(`📤 Uploading buffer to Pinata as ${filename}...`);
      
      const formData = new FormData();
      
      // Create a Blob from the buffer for web compatibility
      const blob = new Blob([fileBuffer]);
      formData.append('file', blob, filename);
      
      // Add metadata
      const metadata = JSON.stringify({
        name: filename
      });
      formData.append('pinataMetadata', metadata);
      
      const response = await axios.post(
        `${this.apiUrl}/pinning/pinFileToIPFS`,
        formData,
        {
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'multipart/form-data'
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );
      
      if (response.status === 200) {
        const ipfsHash = response.data.IpfsHash;
        const ipfsUri = `ipfs://${ipfsHash}`;
        const gatewayUrl = this.getGatewayUrl(ipfsHash);
        
        console.log(`✅ Buffer pinned to IPFS with hash: ${ipfsHash}`);
        console.log(`🔗 Gateway URL: ${gatewayUrl}`);
        
        return ipfsUri;
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error: unknown) {
      let errorDetails: string;
      
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response: { data?: { error?: unknown } } };
        errorDetails = JSON.stringify(axiosError.response?.data?.error) || 'Unknown error';
      } else {
        errorDetails = error instanceof Error ? error.message : 'Unknown error';
      }
      
      console.error(`❌ Error pinning buffer to IPFS: ${errorDetails}`);
      throw new Error(`Failed to pin buffer to IPFS: ${errorDetails}`);
    }
  }

  /**
   * Get content from IPFS via gateway
   * @param cid The IPFS CID to fetch
   * @returns Promise resolving to the content
   */
  async getFromIPFS(cid: string): Promise<unknown> {
    try {
      // Remove ipfs:// prefix if present
      const cleanCid = cid.replace('ipfs://', '');
      const gatewayUrl = this.getGatewayUrl(cleanCid);
      
      const response = await axios.get(gatewayUrl);
      return response.data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error fetching from IPFS: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get the gateway URL for an IPFS hash
   * @param ipfsHash The IPFS hash (CID)
   * @returns The gateway URL
   */
  getGatewayUrl(ipfsHash: string): string {
    // Remove ipfs:// prefix if present
    const hash = ipfsHash.replace('ipfs://', '');
    return `https://${this.gatewayUrl}/ipfs/${hash}`;
  }
} 