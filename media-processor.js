const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");

/**
 * Validate and prepare image parts for Gemini Vision API
 * @param {Buffer} imageBuffer - Image buffer
 * @param {string} mimeType - Image MIME type
 * @returns {Object} - Formatted image part for Gemini API
 */
function prepareImagePart(imageBuffer, mimeType) {
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!supportedTypes.includes(mimeType)) {
        throw new Error(`Unsupported image type: ${mimeType}`);
    }
    
    return {
        inlineData: {
            data: imageBuffer.toString("base64"),
            mimeType: mimeType,
        },
    };
}

/**
 * Extract text from PDF buffer
 * @param {Buffer} pdfBuffer - The PDF buffer
 * @returns {Promise<Object>} - Extracted text and metadata
 */
async function extractPdfText(pdfBuffer) {
    try {
        console.log(`Processing PDF, size: ${(pdfBuffer.length / 1024).toFixed(2)}KB`);
        
        if (!pdfBuffer || pdfBuffer.length === 0) {
            throw new Error("Invalid PDF buffer");
        }
        
        const pdfSignature = pdfBuffer.slice(0, 4).toString();
        if (pdfSignature !== '%PDF') {
            throw new Error("Invalid PDF format");
        }
        
        const data = await pdfParse(pdfBuffer, {
            max: 0,
            version: 'v1.10.100'
        });
        
        let cleanText = data.text
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();

        if (cleanText.length === 0) {
            throw new Error("No readable text found in PDF.");
        }
        
        const metadata = {
            pages: data.numpages,
            info: data.info || {},
            textLength: cleanText.length,
            wordCount: cleanText.split(/\s+/).length
        };
        
        console.log(`PDF processed: ${metadata.pages} pages, ${metadata.wordCount} words`);
        
        return {
            success: true,
            text: cleanText,
            metadata: metadata,
            summary: `📄 PDF Document Analysis:\n• Pages: ${metadata.pages}\n• Words: ${metadata.wordCount}\n• Characters: ${metadata.textLength}`
        };
        
    } catch (error) {
        console.error("PDF extraction error:", error);
        
        return {
            success: false,
            error: error.message,
            text: "",
            metadata: {},
            summary: `❌ PDF processing failed: ${error.message}`
        };
    }
}

/**
 * Process image for Gemini Vision API
 * @param {Buffer} imageBuffer - The image buffer
 * @param {string} mimeType - The image MIME type
 * @returns {Promise<Object>} - Processed image data
 */
async function processImage(imageBuffer, mimeType) {
    try {
        console.log(`Processing image: ${mimeType}, size: ${(imageBuffer.length / 1024).toFixed(2)}KB`);
        
        if (!imageBuffer || imageBuffer.length === 0) {
            throw new Error("Invalid image buffer");
        }
        
        const supportedFormats = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
        if (!supportedFormats.includes(mimeType.toLowerCase())) {
            throw new Error(`Unsupported image format: ${mimeType}`);
        }
        
        const maxSize = 20 * 1024 * 1024; // 20MB
        if (imageBuffer.length > maxSize) {
            throw new Error("Image file too large (max 20MB)");
        }
        
        const imagePart = prepareImagePart(imageBuffer, mimeType);
        
        const metadata = {
            mimeType: mimeType,
            size: imageBuffer.length,
            sizeFormatted: `${(imageBuffer.length / 1024).toFixed(2)}KB`
        };
        
        console.log(`Image processed successfully: ${metadata.sizeFormatted}`);
        
        return {
            success: true,
            imagePart: imagePart,
            metadata: metadata,
            summary: `🖼️ Image Analysis Ready:\n• Format: ${mimeType}\n• Size: ${metadata.sizeFormatted}`
        };
        
    } catch (error) {
        console.error("Image processing error:", error);
        
        return {
            success: false,
            error: error.message,
            imagePart: null,
            metadata: {},
            summary: `❌ Image processing failed: ${error.message}`
        };
    }
}

/**
 * Save media file for debugging (optional)
 * @param {Buffer} mediaBuffer - The media buffer
 * @param {string} mimeType - The MIME type
 * @param {string} prefix - File prefix (pdf, image, etc.)
 * @returns {Promise<string>} - File path where media was saved
 */
async function saveMediaFile(mediaBuffer, mimeType, prefix = 'media') {
    try {
        let extension = 'bin';
        if (mimeType.includes('pdf')) extension = 'pdf';
        else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = 'jpg';
        else if (mimeType.includes('png')) extension = 'png';
        else if (mimeType.includes('webp')) extension = 'webp';
        else if (mimeType.includes('gif')) extension = 'gif';
        
        const filename = `${prefix}_${Date.now()}.${extension}`;
        
        // For Render deployment, use /tmp directory
        const tempDir = process.env.NODE_ENV === 'production' ? '/tmp' : path.join(__dirname, 'temp');
        
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const filepath = path.join(tempDir, filename);
        fs.writeFileSync(filepath, mediaBuffer);
        console.log(`Media saved to: ${filepath}`);
        
        return filepath;
    } catch (error) {
        console.error("Error saving media file:", error);
        return null;
    }
}

/**
 * Analyze PDF content and generate summary
 * @param {string} text - Extracted PDF text
 * @param {Object} metadata - PDF metadata
 * @returns {string} - Content analysis summary
 */
function analyzePdfContent(text, metadata) {
    try {
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
        
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        const headings = lines.filter(line => 
            line.length < 100 && 
            line.trim().match(/^[A-Z]/) && 
            !line.includes('.')
        ).slice(0, 5);
        
        let analysis = `📊 Content Analysis:\n`;
        analysis += `• Sentences: ${sentences.length}\n`;
        analysis += `• Paragraphs: ${paragraphs.length}\n`;
        
        if (headings.length > 0) {
            analysis += `• Key Sections:\n`;
            headings.forEach(heading => {
                analysis += `  - ${heading.trim().substring(0, 50)}...\n`;
            });
        }
        
        const preview = sentences.slice(0, 3).join('. ').substring(0, 200) + '...';
        analysis += `\n📝 Preview:\n${preview}`;
        
        return analysis;
    } catch (error) {
        console.error("PDF analysis error:", error);
        return "📄 Basic PDF content extracted successfully.";
    }
}

/**
 * Get supported media formats
 * @returns {Object} - Supported formats by type
 */
function getSupportedFormats() {
    return {
        images: [
            'image/jpeg',
            'image/jpg', 
            'image/png',
            'image/webp',
            'image/gif'
        ],
        documents: [
            'application/pdf'
        ],
        audio: [
            'audio/ogg',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/m4a',
            'audio/webm'
        ],
        maxSizes: {
            image: '20MB',
            pdf: '50MB',
            audio: '10MB'
        }
    };
}

/**
 * Check if media format is supported
 * @param {string} mimeType - The MIME type to check
 * @returns {Object} - Support status and type
 */
function isMediaSupported(mimeType) {
    const formats = getSupportedFormats();
    
    if (formats.images.includes(mimeType.toLowerCase())) {
        return { supported: true, type: 'image' };
    } else if (formats.documents.includes(mimeType.toLowerCase())) {
        return { supported: true, type: 'document' };
    } else if (formats.audio.includes(mimeType.toLowerCase())) {
        return { supported: true, type: 'audio' };
    } else {
        return { supported: false, type: 'unknown' };
    }
}

/**
 * Get media processing service status
 * @returns {Object} - Service status information
 */
function getMediaProcessingStatus() {
    return {
        pdfExtraction: "✅ Available",
        imageProcessing: "✅ Available", 
        visionAPI: "✅ Integrated",
        audioProcessing: "✅ Available",
        supportedFormats: getSupportedFormats(),
        features: {
            pdfTextExtraction: "✅ Enabled",
            pdfMetadata: "✅ Enabled",
            imageAnalysis: "✅ Enabled",
            audioTranscription: "✅ Enabled",
            contentSummary: "✅ Enabled",
            fileValidation: "✅ Enabled"
        },
        limits: {
            maxImageSize: "20MB",
            maxPdfSize: "50MB",
            maxAudioSize: "10MB",
            supportedImageFormats: 5,
            supportedDocumentFormats: 1,
            supportedAudioFormats: 6
        }
    };
}

module.exports = {
    extractPdfText,
    processImage,
    saveMediaFile,
    analyzePdfContent,
    getSupportedFormats,
    isMediaSupported,
    getMediaProcessingStatus,
    prepareImagePart
};

