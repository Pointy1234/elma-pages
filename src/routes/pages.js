import express from 'express';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { PDFDocument, rgb } from 'pdf-lib';
import logger from '../logger.js';

const router = express.Router();
const tempDir = path.join(process.cwd(), 'temp');

// Ensure the temp directory exists
fs.ensureDirSync(tempDir);

// Function to download file from URL
const downloadFile = async (url) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return response;
  } catch (error) {
    logger.error(`Failed to download file: ${error.message}`);
    throw new Error('Failed to download file');
  }
};

// Function to extract file details from content-disposition header
const extractFileDetails = (contentDisposition) => {
  let fileName = 'unknown';
  let fileExtension = 'unknown';

  const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
  if (fileNameMatch) {
    fileName = fileNameMatch[1];
    const extensionMatch = fileName.match(/\.(\w+)$/);
    if (extensionMatch) {
      fileExtension = extensionMatch[1].toLowerCase();
    }
  }

  return { fileName, fileExtension };
};

// Function to convert DOCX to PDF
const convertDocxToPdf = async (docxBuffer, pdfPath) => {
  try {
    // Преобразуем DOCX в HTML/текст с помощью Mammoth
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    const text = result.value;

    // Создаем новый PDF-документ
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4 формат

    // Настраиваем шрифт и текст
    const fontSize = 12;
    page.drawText(text, {
      x: 50,
      y: 800,
      size: fontSize,
      color: rgb(0, 0, 0),
      maxWidth: 500, // ширина текста
    });

    // Сохраняем PDF в файл
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(pdfPath, pdfBytes);

    console.log('PDF successfully created');
  } catch (error) {
    console.error(`Failed to convert DOCX to PDF: ${error.message}`);
    throw new Error('Failed to convert DOCX to PDF');
  }
};

// Function to get page count from PDF buffer
const getPdfPageCount = async (pdfBuffer) => {
  try {
    const data = await pdfParse(pdfBuffer);
    return data.numpages || 0;
  } catch (error) {
    logger.error(`Failed to count pages in PDF: ${error.message}`);
    throw new Error('Failed to count pages in PDF');
  }
};

// POST handler for /pages
router.post('/pages', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    logger.warn('URL is required');
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    logger.info(`Processing file from URL: ${url}`);
    const response = await downloadFile(url);
    const { data: fileBuffer, headers } = response;

    const contentDisposition = headers['content-disposition'] || '';
    const { fileExtension } = extractFileDetails(contentDisposition);

    const tempDocxPath = path.join(tempDir, 'input.docx');
    const tempPdfPath = path.join(tempDir, 'output.pdf');
    fs.writeFileSync(tempDocxPath, fileBuffer);

    let pageCount = 0;

    if (fileExtension === 'pdf') {
      pageCount = await getPdfPageCount(fileBuffer);
    } else if (fileExtension === 'docx') {
      await convertDocxToPdf(fileBuffer, tempPdfPath);
      const pdfBuffer = fs.readFileSync(tempPdfPath);
      pageCount = await getPdfPageCount(pdfBuffer);
    } else {
      logger.warn('Unsupported file format');
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    logger.info(`Page count for file ${fileExtension}: ${pageCount}`);
    res.json({ pageCount });

  } catch (error) {
    logger.error(`Internal server error: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
