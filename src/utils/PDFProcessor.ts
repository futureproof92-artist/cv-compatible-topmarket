
/**
 * PDFProcessor.ts - Módulo para validación básica de PDFs
 * 
 * NOTA: Este módulo ha sido simplificado para eliminar la dependencia de pdfjs-dist.
 * Todo el procesamiento del texto de PDFs ahora se realiza en el servidor
 * usando Google Vision API a través de Edge Functions.
 */

/**
 * Valida si un archivo es un PDF basado en su tipo MIME
 */
export const validatePDF = (file: File): boolean => {
  return file.type === 'application/pdf';
};

/**
 * Función que ahora solo valida el archivo y devuelve un mensaje
 * informativo indicando que el procesamiento se realizará en el servidor.
 */
export const processPDF = async (file: File): Promise<string> => {
  try {
    console.log('Preparando archivo PDF para enviar al servidor:', file.name);
    
    if (!validatePDF(file)) {
      throw new Error('El archivo no es un PDF válido');
    }
    
    // Devolvemos una cadena vacía para indicar que el procesamiento
    // se realizará en el servidor
    return '';
  } catch (error) {
    console.error('Error validando PDF:', error);
    throw new Error('Error al procesar el PDF: ' + (error instanceof Error ? error.message : 'Error desconocido'));
  }
};

/**
 * Verifica si un PDF contiene texto seleccionable
 * Esta función ahora simplemente comprueba si el archivo es un PDF válido
 */
export const hasPDFText = async (file: File): Promise<boolean> => {
  try {
    // Ahora solo verificamos si es un PDF válido
    return validatePDF(file);
  } catch (error) {
    console.error('Error verificando PDF:', error);
    return false;
  }
};

