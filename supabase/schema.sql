-- Minimal Zoiner AI Agent Schema (without user profiles)
-- This provides core AI functionality without long-term user tracking

-- Cache image analyses to avoid re-processing expensive Claude Vision calls
CREATE TABLE image_analyses (
  id SERIAL PRIMARY KEY,
  image_url TEXT UNIQUE NOT NULL,
  analysis_result TEXT NOT NULL,
  artistic_style TEXT NOT NULL,
  color_palette TEXT[],
  mood TEXT NOT NULL,
  composition_notes TEXT NOT NULL,
  suggested_names TEXT[] NOT NULL,
  suggested_symbols TEXT[] NOT NULL,
  artistic_elements TEXT[] NOT NULL,
  visual_description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Store recent conversations for immediate context (last 5 per user)
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL,
  cast_hash TEXT NOT NULL UNIQUE,
  user_message TEXT NOT NULL,
  agent_response TEXT NOT NULL,
  image_url TEXT,
  image_analysis_id INTEGER REFERENCES image_analyses(id),
  action_taken TEXT NOT NULL CHECK (action_taken IN ('create_token', 'clarify', 'help', 'encourage', 'celebrate')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Track successful token creations
CREATE TABLE ai_token_creations (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL,
  conversation_id INTEGER REFERENCES conversations(id),
  token_address TEXT NOT NULL,
  token_name TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_analysis_id INTEGER REFERENCES image_analyses(id),
  ai_generated_description TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  zora_url TEXT,
  transaction_hash TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Auto-cleanup old conversations (keep only recent 5 per user)
CREATE OR REPLACE FUNCTION cleanup_old_conversations()
RETURNS void AS $$
BEGIN
  DELETE FROM conversations 
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY fid ORDER BY created_at DESC) as rn
      FROM conversations
    ) ranked 
    WHERE rn <= 5
  );
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-cleanup after inserts
CREATE OR REPLACE FUNCTION trigger_cleanup_conversations()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM cleanup_old_conversations();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cleanup_conversations_trigger
  AFTER INSERT ON conversations
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_cleanup_conversations();

-- Indexes for performance
CREATE INDEX idx_conversations_fid_created_at ON conversations(fid, created_at DESC);
CREATE INDEX idx_image_analyses_url ON image_analyses(image_url);
CREATE INDEX idx_ai_token_creations_fid ON ai_token_creations(fid); 