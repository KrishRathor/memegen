import express from "express";
import dotenv from "dotenv";

dotenv.config();

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

class MemeGeneratorServer {
  constructor() {}

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

  async fetchIndianNews(topic = ""): Promise<NewsArticle[]> {
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

    const res = await fetch(`${baseUrl}?${params}`);
    if (!res.ok) {
      throw new Error(`NewsData API error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    if (!Array.isArray(data.results)) {
      return [];
    }
    return data.results;
  }

  async fetchImgflipTemplates(): Promise<ImgflipTemplate[]> {
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
    return json.data.memes.slice(0, 100).map(({ id, name }: any) => ({
      id: Number(id),
      name,
    }));
  }

  async generateCaption(
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
          parts: [{ text: prompt }],
        },
      ],
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const output = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!output) return null;
    return this.parseMemeCaption(output);
  }

  async generateMeme(
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

    const res = await fetch(`https://api.imgflip.com/caption_image`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data: any = await res.json();
    if (!data.success) {
      throw new Error(`Imgflip API error: ${data.error_message}`);
    }
    return data.data?.url || null;
  }

  parseMemeCaption(caption: string): MemeCaption | null {
    try {
      const cleaned = caption
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const json = JSON.parse(cleaned);

      return {
        image: Number(json.image),
        topText: String(json.topText),
        bottomText: String(json.bottomText),
      };
    } catch {
      return null;
    }
  }
}

const app = express();
app.use(express.json());

const memeService = new MemeGeneratorServer();

// Routes
app.get("/fetch_indian_news", async (req, res) => {
  try {
    memeService["validateEnvVars"]();
    const topic = req.query.topic?.toString() || "";
    const news = await memeService.fetchIndianNews(topic);
    res.json({ success: true, count: news.length, articles: news });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/get_meme_templates", async (req, res) => {
  try {
    const templates = await memeService.fetchImgflipTemplates();
    res.json({ success: true, count: templates.length, templates });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/generate_meme_caption", async (req, res) => {
  try {
    memeService["validateEnvVars"]();
    const { title, description, availableTemplates } = req.body;
    if (!title || !description || !availableTemplates) {
      throw new Error("Missing required parameters");
    }
    const caption = await memeService.generateCaption(
      title,
      description,
      availableTemplates
    );
    res.json({ success: true, caption });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/create_meme", async (req, res) => {
  try {
    memeService["validateEnvVars"]();
    const { templateId, topText, bottomText } = req.body;
    if (!templateId || !topText || !bottomText) {
      throw new Error("Missing required parameters");
    }
    const memeUrl = await memeService.generateMeme(
      templateId,
      topText,
      bottomText
    );
    res.json({ success: true, memeUrl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/generate_news_meme", async (req, res) => {
  try {
    memeService["validateEnvVars"]();
    const topic = req.body.topic || "";
    const articleIndex = req.body.articleIndex || 0;

    const news = await memeService.fetchIndianNews(topic);
    if (!news.length) throw new Error("No news articles found");
    const article = news[articleIndex];
    if (!article?.title || !article?.description) {
      throw new Error("Invalid article");
    }

    const templates = await memeService.fetchImgflipTemplates();
    const templateIds = templates.map((t) => t.id);

    const caption = await memeService.generateCaption(
      article.title,
      article.description,
      templateIds
    );
    if (!caption) throw new Error("Failed to generate meme caption");

    const memeUrl = await memeService.generateMeme(
      caption.image,
      caption.topText,
      caption.bottomText
    );

    res.json({
      success: true,
      article: { title: article.title, description: article.description },
      caption,
      memeUrl,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/puch_generate_meme", async (req, res) => {
  try {
    memeService["validateEnvVars"]();

    const topic = req.body.topic || req.body.params?.topic || "";
    const articleIndex = req.body.articleIndex || 0;

    if (!topic) {
      throw new Error("Topic is required");
    }

    const news = await memeService.fetchIndianNews(topic);
    if (!news.length) {
      throw new Error(`No news articles found for topic: ${topic}`);
    }
    const article = news[articleIndex];
    if (!article?.title || !article?.description) {
      throw new Error("Selected article is missing title/description");
    }

    const templates = await memeService.fetchImgflipTemplates();
    const templateIds = templates.map((t) => t.id);

    const caption = await memeService.generateCaption(
      article.title,
      article.description,
      templateIds
    );
    if (!caption) {
      throw new Error("Failed to generate meme caption");
    }

    const memeUrl = await memeService.generateMeme(
      caption.image,
      caption.topText,
      caption.bottomText
    );
    if (!memeUrl) {
      throw new Error("Failed to create meme image");
    }

    res.json({
      success: true,
      article: {
        title: article.title,
        description: article.description,
        link: article.link || null,
      },
      caption,
      memeUrl,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Meme Generator API running on port ${PORT}`);
});

