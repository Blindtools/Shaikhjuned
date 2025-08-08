const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const { prepareImagePart } = require("./gemini-config");

/**
 * Extract text from PDF buffer
 * @param {Buffer} pdfBuffer - The PDF buffer
 * @returns {Promise<Object>} - Extracted text and metadata
 */
async function extractPdfText(pdfBuffer) {
    try {
        console.log(`Processing PDF, size: ${(pdfBuffer.length / 1024).toFixed(2)}KB`);
        
        // Validate PDF buffer
        if (!pdfBuffer || pdfBuffer.length === 0) {
            throw new Error("Invalid PDF buffer");
        }
        
        // Check if buffer starts with PDF signature
        const pdfSignature = pdfBuffer.slice(0, 4).toString();
        if (pdfSignature !== '%PDF') {
            throw new Error("Invalid PDF format");
        }
        
        // Parse PDF
        const data = await pdfParse(pdfBuffer, {
            // Options for better text extraction
            max: 0, // No page limit
            version: 'v1.10.100'
        });
        
        // Clean and process extracted text
        let cleanText = data.text
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .replace(/\n\s*\n/g, '\n') // Remove empty lines
            .trim();
        
        // Extract metadata
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
        
        // Validate image buffer
        if (!imageBuffer || imageBuffer.length === 0) {
            throw new Error("Invalid image buffer");
        }
        
        // Check supported formats
        const supportedFormats = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
        if (!supportedFormats.includes(mimeType.toLowerCase())) {
            throw new Error(`Unsupported image format: ${mimeType}`);
        }
        
        // Check file size (limit to 20MB for Gemini Vision)
        const maxSize = 20 * 1024 * 1024; // 20MB
        if (imageBuffer.length > maxSize) {
            throw new Error("Image file too large (max 20MB)");
        }
        
        // Prepare image part for Gemini API
        const imagePart = prepareImagePart(imageBuffer, mimeType);
        
        // Get image metadata
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
        // Determine file extension
        let extension = 'bin';
        if (mimeType.includes('pdf')) extension = 'pdf';
        else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = 'jpg';
        else if (mimeType.includes('png')) extension = 'png';
        else if (mimeType.includes('webp')) extension = 'webp';
        else if (mimeType.includes('gif')) extension = 'gif';
        
        const filename = `${prefix}_${Date.now()}.${extension}`;
        const filepath = path.join(__dirname, 'temp', filename);
        
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
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
        // Basic content analysis
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
        
        // Find potential headings (lines that are short and start with capital letters)
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        const headings = lines.filter(line => 
            line.length < 100 && 
            line.trim().match(/^[A-Z]/) && 
            !line.includes('.')
        ).slice(0, 5);
        
        // Generate analysis
        let analysis = `📊 Content Analysis:\n`;
        analysis += `• Sentences: ${sentences.length}\n`;
        analysis += `• Paragraphs: ${paragraphs.length}\n`;
        
        if (headings.length > 0) {
            analysis += `• Key Sections:\n`;
            headings.forEach(heading => {
                analysis += `  - ${heading.trim().substring(0, 50)}...\n`;
            });
        }
        
        // Extract first few sentences as preview
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
        maxSizes: {
            image: '20MB',
            pdf: '50MB'
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
        supportedFormats: getSupportedFormats(),
        features: {
            pdfTextExtraction: "✅ Enabled",
            pdfMetadata: "✅ Enabled",
            imageAnalysis: "✅ Enabled",
            contentSummary: "✅ Enabled",
            fileValidation: "✅ Enabled"
        },
        limits: {
            maxImageSize: "20MB",
            maxPdfSize: "50MB",
            supportedImageFormats: 5,
            supportedDocumentFormats: 1
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
    getMediaProcessingStatus
};

