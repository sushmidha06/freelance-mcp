import dotenv from 'dotenv';
dotenv.config();

export const mcpConfig = {
  // Production-level external MCP server URLs
  gmailUrl: process.env.MCP_GMAIL_SERVER_URL || 'https://mcp-gmail-production.example.com',
  githubUrl: process.env.MCP_GITHUB_SERVER_URL || 'https://mcp-github-production.example.com',
  gcalUrl: process.env.MCP_GCAL_SERVER_URL || 'https://mcp-gcal-production.example.com',
  billingUrl: process.env.MCP_BILLING_SERVER_URL || 'https://mcp-billing-production.example.com',
  
  // Timeout and retry settings for production robustness
  timeout: 5000,
  maxRetries: 3
};

