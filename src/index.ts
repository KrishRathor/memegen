import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Interfaces
interface NewsArticle {
  title: string;
  description: string;
  link?: string;
  pubDate?: string;
}

interface ImgflipTemplate {
  id: number;
  name: string;
}

interface MemeCaption {
  image: number;
  topText: string;
  bottomText: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface ImgflipResponse {
  success: boolean;
  data?: {
    url: string;
  };
  error_message?: string;
}

class MemeGeneratorServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "meme-generator-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error: any) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "fetch_indian_news",
            description:
              "Fetch latest Indian news articles by topic. Returns up to 10 recent articles from Indian news sources in English.",
            inputSchema: {
              type: "object",
              properties: {
                topic: {
                  type: "string",
                  description:
                    "News topic to search for (optional). If empty, returns general Indian news.",
                },
              },
            },
          },
          {
            name: "get_meme_templates",
            description:
              "Fetch available meme templates from Imgflip. Returns top 100 popular meme templates with their IDs and names.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "generate_meme_caption",
            description:
              "Generate funny meme caption for a news article using Gemini AI. Returns JSON with template ID and top/bottom text.",
            inputSchema: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "News article title",
                },
                description: {
                  type: "string",
                  description: "News article description",
                },
                availableTemplates: {
                  type: "array",
                  items: {
                    type: "number",
                  },
                  description: "Array of available template IDs to choose from",
                },
              },
              required: ["title", "description", "availableTemplates"],
            },
          },
          {
            name: "create_meme",
            description:
              "Create a meme image using Imgflip API with specified template and text. Returns the URL of the generated meme.",
            inputSchema: {
              type: "object",
              properties: {
                templateId: {
                  type: "number",
                  description: "Imgflip template ID",
                },
                topText: {
                  type: "string",
                  description: "Text for the top of the meme",
                },
                bottomText: {
                  type: "string",
                  description: "Text for the bottom of the meme",
                },
              },
              required: ["templateId", "topText", "bottomText"],
            },
          },
          {
            name: "generate_news_meme",
            description:
              "Complete workflow: fetch news, generate caption, and create meme. This is a convenience tool that combines all steps.",
            inputSchema: {
              type: "object",
              properties: {
                topic: {
                  type: "string",
                  description: "News topic to search for (optional)",
                },
                articleIndex: {
                  type: "number",
                  description:
                    "Index of article to use from search results (default: 0)",
                  default: 0,
                },
              },
            },
          },
        ] satisfies Tool[],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "fetch_indian_news":
            return await this.handleFetchNews(args);
          case "get_meme_templates":
            return await this.handleGetTemplates(args);
          case "generate_meme_caption":
            return await this.handleGenerateCaption(args);
          case "create_meme":
            return await this.handleCreateMeme(args);
          case "generate_news_meme":
            return await this.handleGenerateNewsMeme(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  private validateEnvVars(): void {
    const required = [
      "NEWSDATA_API_KEY",
      "GEMINI_API_KEY",
      "IMGFLIP_USERNAME",
      "IMGFLIP_PASSWORD",
    ];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }
  }

  private async handleFetchNews(args: any) {
    this.validateEnvVars();
    const topic = args?.topic || "";
    const news = await this.getIndianNewsByTopic(topic);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              count: news.length,
              articles: news,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleGetTemplates(args: any) {
    const templates = await this.fetchImgflipTemplates();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              count: templates.length,
              templates: templates,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleGenerateCaption(args: any) {
    this.validateEnvVars();
    const { title, description, availableTemplates } = args;

    if (!title || !description || !availableTemplates) {
      throw new Error(
        "Missing required parameters: title, description, availableTemplates"
      );
    }

    const caption = await this.generateCaption(
      title,
      description,
      availableTemplates
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              caption: caption,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleCreateMeme(args: any) {
    this.validateEnvVars();
    const { templateId, topText, bottomText } = args;

    if (!templateId || !topText || !bottomText) {
      throw new Error(
        "Missing required parameters: templateId, topText, bottomText"
      );
    }

    const memeUrl = await this.generateMeme(templateId, topText, bottomText);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              memeUrl: memeUrl,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleGenerateNewsMeme(args: any) {
    this.validateEnvVars();
    const topic = args?.topic || "";
    const articleIndex = args?.articleIndex || 0;

    try {
      // Step 1: Fetch news
      const news = await this.getIndianNewsByTopic(topic);
      if (news.length === 0) {
        throw new Error("No news articles found");
      }

      const article = news[articleIndex];
      if (!article || !article.title || !article.description) {
        throw new Error("Selected article missing title or description");
      }

      // Step 2: Get templates
      const templates = await this.fetchImgflipTemplates();
      const templateIds = templates.map((t) => t.id);

      // Step 3: Generate caption
      const caption = await this.generateCaption(
        article.title,
        article.description,
        templateIds
      );

      if (!caption) {
        throw new Error("Failed to generate meme caption");
      }

      // Step 4: Create meme
      const memeUrl = await this.generateMeme(
        caption.image,
        caption.topText,
        caption.bottomText
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                article: {
                  title: article.title,
                  description: article.description,
                },
                caption: caption,
                memeUrl: memeUrl,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      throw new Error(
        `Failed to generate news meme: ${error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  // Core functionality methods (adapted from original code)
  private async getIndianNewsByTopic(
    topic: string = ""
  ): Promise<NewsArticle[]> {
    const baseUrl = "https://newsdata.io/api/1/latest";
    const apiKey = process.env.NEWSDATA_API_KEY!;

    const params = new URLSearchParams({
      apikey: apiKey,
      country: "in",
      language: "en",
      size: "10",
    });

    if (topic.trim()) {
      params.append("q", topic);
    }

    try {
      const response = await fetch(`${baseUrl}?${params}`);

      if (!response.ok) {
        throw new Error(
          `NewsData API error: ${response.status} ${response.statusText}`
        );
      }

      const data: any = await response.json();

      if (!data.results || !Array.isArray(data.results)) {
        console.warn("NewsData API returned unexpected format");
        return [];
      }

      return data.results;
    } catch (error) {
      console.error("Error fetching Indian news:", error);
      throw new Error(
        `Failed to fetch news: ${error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async generateCaption(
    title: string,
    description: string,
    availableTemplates: number[]
  ): Promise<MemeCaption | null> {
    const prompt = `Generate a meme worthy caption for the following news: ${title}, ${description}

    Response should be valid JSON in this exact format:
    {
      "image": <number>,
      "topText": "<string>",
      "bottomText": "<string>"
    }

    The image number should be a template ID from imgflip that's relevant to this meme.
    Choose from these template IDs only: ${availableTemplates.join(", ")}
    
    Make the meme funny and relevant to the news content.`;

    const geminiApiKey = process.env.GEMINI_API_KEY!;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

    const body = {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
      }

      const data: any = await res.json();
      const output = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!output) {
        console.warn("Gemini API returned empty response");
        return null;
      }

      return this.parseMemeCaption(output);
    } catch (err) {
      console.error("Error calling Gemini API:", err);
      throw new Error(
        `Failed to generate caption: ${err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }

  private async generateMeme(
    templateId: number,
    topText: string,
    bottomText: string
  ): Promise<string | null> {
    const username = process.env.IMGFLIP_USERNAME!;
    const password = process.env.IMGFLIP_PASSWORD!;

    const params = new URLSearchParams({
      template_id: templateId.toString(),
      username,
      password,
      text0: topText,
      text1: bottomText,
    });

    try {
      const res = await fetch(`https://api.imgflip.com/caption_image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      if (!res.ok) {
        throw new Error(`Imgflip API error: ${res.status} ${res.statusText}`);
      }

      const data: any = await res.json();

      if (!data.success) {
        throw new Error(`Imgflip API error: ${data.error_message}`);
      }

      return data.data?.url || null;
    } catch (err) {
      console.error("Error generating meme:", err);
      throw new Error(
        `Failed to generate meme: ${err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }

  private async fetchImgflipTemplates(): Promise<ImgflipTemplate[]> {
    try {
      const res = await fetch("https://api.imgflip.com/get_memes");

      if (!res.ok) {
        throw new Error(
          `Imgflip templates API error: ${res.status} ${res.statusText}`
        );
      }

      const json: any = await res.json();

      if (!json.success) {
        throw new Error("Imgflip API returned success: false");
      }

      const memes = json.data.memes.slice(0, 100); // Limit to top 100
      return memes.map(({ id, name }: { id: number; name: string }) => ({
        id,
        name,
      }));
    } catch (err) {
      console.error("Error fetching Imgflip templates:", err);
      throw new Error(
        `Failed to fetch templates: ${err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }

  private parseMemeCaption(caption: string): MemeCaption | null {
    try {
      const cleaned = caption
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const json = JSON.parse(cleaned);

      if (!json.image || !json.topText || !json.bottomText) {
        console.error("Invalid meme caption format - missing required fields");
        return null;
      }

      const imageId = Number(json.image);
      if (isNaN(imageId)) {
        console.error("Invalid image template ID");
        return null;
      }

      return {
        image: imageId,
        topText: String(json.topText),
        bottomText: String(json.bottomText),
      };
    } catch (error) {
      console.error("Error parsing meme caption JSON:", error);
      return null;
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Meme Generator MCP server running on stdio");
  }
}

const server = new MemeGeneratorServer();
server.run().catch(console.error);

