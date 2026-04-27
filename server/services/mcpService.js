import axios from 'axios';
import { mcpConfig } from '../config/mcp.js';

export class MCPService {
  constructor() {
    this.client = axios.create({
      timeout: mcpConfig.timeout,
    });
  }

  async callMcp(serverUrl, method, params = {}) {
    try {
      const response = await this.client.post(`${serverUrl}/${method}`, params);
      return response.data;
    } catch (error) {
      console.error(`MCP Error (${method}):`, error.message);
      return null;
    }
  }

  async getRecentEmails(userId) {
    return this.callMcp(mcpConfig.gmailUrl, 'get-emails', { userId });
  }

  async getGithubRepoStats(userId, repo) {
    return this.callMcp(mcpConfig.githubUrl, 'get-repo-stats', { userId, repo });
  }

  async getCalendarEvents(userId) {
    return this.callMcp(mcpConfig.gcalUrl, 'get-events', { userId });
  }
  
  async syncBillingData(userId) {
    return this.callMcp(mcpConfig.billingUrl, 'sync-invoices', { userId });
  }
}
