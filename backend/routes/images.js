import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { getDatabase } from '../db.js';
import { verifyToken } from './auth.js';
import sharp from 'sharp';

export const imageRoutes = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../uploads');

// Ensure uploads directory exists
await fs.mkdir(uploadsDir, { recursive: true });

// Multer configuration
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'image-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG and WebP images are allowed'));
    }
  },
});

// Initialize Gemini (new SDK)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Upload images
imageRoutes.post('/upload', verifyToken, upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const db = getDatabase();
    const uploadedImages = [];

    for (const file of req.files) {
      const imageData = await db.run(
        'INSERT INTO images (user_id, filename, original_path, status) VALUES (?, ?, ?, ?)',
        [req.user.id, file.originalname, file.path, 'processing']
      );

      uploadedImages.push({
        id: imageData.lastID,
        filename: file.filename,
        originalName: file.originalname,
        path: `/uploads/${file.filename}`,
      });

      // Analyze image asynchronously
      analyzeImage(imageData.lastID, file.path, req.user.id);
    }

    res.json({ images: uploadedImages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze image with Gemini and get segmentation data
async function analyzeImage(imageId, imagePath, userId) {
  try {
    const db = getDatabase();

    // Read image file
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Choose correct mimeType based on file extension
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    // Use latest fast multimodal model
    const model = 'gemini-2.5-pro';

    const prompt = `You are an agricultural expert analyzing field images for weed detection and crop segmentation.

Analyze this agricultural field image and:
1) Identify areas affected by weeds
2) Identify healthy crop areas
3) Provide detection bounding boxes for prominent items

Return ONLY valid JSON with no markdown fencing, using this schema:
{
  "totalArea": number,                     // percent 0-100
  "weedCoverage": number,                  // percent 0-100
  "healthyCropCoverage": number,           // percent 0-100
  "items": [                               // detected items
    {
      "label": string,                     // e.g. "weed", "crop", "bare_soil"
      "confidence": number,                // 0-100
      "box_2d": [y0, x0, y1, x1]          // normalized to 0-1000
    }
  ],
  "recommendations": string[]
}`;

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Image,
          },
        },
        { text: prompt },
      ],
    });

    const analysisText = response.text || '';
    
    // Extract JSON from the response
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    let segmentationData;
    
    if (jsonMatch) {
      segmentationData = JSON.parse(jsonMatch[0]);
    } else {
      segmentationData = {
        items: [],
        weedCoverage: 0,
        healthyCropCoverage: 100,
        recommendations: ['Unable to analyze image details'],
      };
    }

    // Derive coverage if missing but items with boxes exist
    if (Array.isArray(segmentationData.items)) {
      const items = segmentationData.items;
      const areaOf = (box) => {
        if (!Array.isArray(box) || box.length !== 4) return 0;
        const ymin = Math.max(0, Math.min(1000, Number(box[0]) || 0));
        const xmin = Math.max(0, Math.min(1000, Number(box[1]) || 0));
        const ymax = Math.max(0, Math.min(1000, Number(box[2]) || 0));
        const xmax = Math.max(0, Math.min(1000, Number(box[3]) || 0));
        const w = Math.max(0, xmax - xmin);
        const h = Math.max(0, ymax - ymin);
        return (w * h) / (1000 * 1000); // normalized area 0..1
      };

      const weedArea = items
        .filter((it) => (it.label || '').toLowerCase().includes('weed'))
        .reduce((sum, it) => sum + areaOf(it.box_2d), 0);
      const cropArea = items
        .filter((it) => (it.label || '').toLowerCase().includes('crop'))
        .reduce((sum, it) => sum + areaOf(it.box_2d), 0);

      if (segmentationData.weedCoverage == null || Number.isNaN(segmentationData.weedCoverage)) {
        segmentationData.weedCoverage = Math.round(Math.max(0, Math.min(100, weedArea * 100)));
      }
      if (segmentationData.healthyCropCoverage == null || Number.isNaN(segmentationData.healthyCropCoverage)) {
        segmentationData.healthyCropCoverage = Math.round(Math.max(0, Math.min(100, cropArea * 100)));
      }
      if (segmentationData.totalArea == null) {
        segmentationData.totalArea = 100;
      }
    }

    await db.run(
      'UPDATE images SET analysis_result = ?, segmentation_data = ?, status = ? WHERE id = ?',
      [analysisText, JSON.stringify(segmentationData), 'completed', imageId]
    );
  } catch (error) {
    console.error(`Error analyzing image ${imageId}:`, error);
    const db = getDatabase();
    await db.run(
      'UPDATE images SET status = ? WHERE id = ?',
      ['failed', imageId]
    );
  }
}

// Get user's images
imageRoutes.get('/', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    const images = await db.all(
      'SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    const processedImages = images.map(img => ({
      ...img,
      segmentationData: img.segmentation_data ? JSON.parse(img.segmentation_data) : null,
      path: `/uploads/${path.basename(img.original_path)}`,
    }));

    res.json({ images: processedImages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single image details
imageRoutes.get('/:id', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    const image = await db.get(
      'SELECT * FROM images WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    image.segmentationData = image.segmentation_data ? JSON.parse(image.segmentation_data) : null;
    image.path = `/uploads/${path.basename(image.original_path)}`;
    res.json(image);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete image
imageRoutes.delete('/:id', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    const image = await db.get(
      'SELECT * FROM images WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Delete file
    await fs.unlink(image.original_path).catch(() => {});

    // Delete from database
    await db.run('DELETE FROM images WHERE id = ?', [req.params.id]);

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
