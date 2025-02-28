
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from 'pdfjs-dist';

// Configura el worker de pdf.js
// En desarrollo, usamos CDN para el worker
GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js`;

export const processPDF = async (file: File): Promise<string> => {
  try {
    console.log('Iniciando procesamiento de PDF:', file.name);

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: arrayBuffer }).promise;
    let extractedText = '';

    console.log(`PDF cargado. Procesando ${pdf.numPages} páginas...`);

    // Itera sobre todas las páginas del PDF
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      console.log(`Procesando página ${pageNum}/${pdf.numPages}`);
      
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .trim();

      if (pageText) {
        extractedText += pageText + '\n';
      }
    }

    const finalText = extractedText.trim();
    console.log('Texto extraído:', finalText ? 'Texto encontrado' : 'No se encontró texto');

    // Si se extrajo texto, devuélvelo; si no, retorna vacío para indicar que es una imagen
    if (!finalText) {
      console.log('PDF parece ser una imagen escaneada o no contiene texto seleccionable');
    }

    return finalText;
  } catch (error) {
    console.error('Error procesando PDF con pdf.js:', error);
    throw new Error('Error al procesar el PDF: ' + (error instanceof Error ? error.message : 'Error desconocido'));
  }
};

// Función para verificar si un PDF contiene texto seleccionable
export const hasPDFText = async (file: File): Promise<boolean> => {
  try {
    const text = await processPDF(file);
    return text.length > 0;
  } catch (error) {
    console.error('Error verificando texto en PDF:', error);
    return false;
  }
};

// Función para validar que el archivo es un PDF válido
export const validatePDF = async (file: File): Promise<boolean> => {
  if (file.type !== 'application/pdf') {
    return false;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    await getDocument({ data: arrayBuffer }).promise;
    return true;
  } catch (error) {
    console.error('Error validando PDF:', error);
    return false;
  }
};
