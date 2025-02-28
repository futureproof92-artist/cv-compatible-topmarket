
/**
 * PDFProcessor.ts - Módulo para validación básica de PDFs
 * 
 * Este módulo realiza solo validaciones básicas.
 * Todo el procesamiento del texto de PDFs se realiza en el servidor
 * usando Google Vision API a través de Edge Functions.
 */

/**
 * Valida si un archivo es un PDF basado en su tipo MIME
 */
export const validatePDF = (file: File): boolean => {
  const isPDF = file.type === 'application/pdf';
  if (!isPDF) {
    console.warn(`Archivo inválido: ${file.name} no es un PDF (tipo: ${file.type})`);
  } else {
    console.log(`Archivo validado como PDF: ${file.name}, tamaño: ${(file.size / 1024).toFixed(2)} KB`);
  }
  return isPDF;
};

/**
 * Función que ahora solo valida el archivo y devuelve un mensaje
 * informativo indicando que el procesamiento se realizará en el servidor.
 */
export const processPDF = async (file: File): Promise<string> => {
  try {
    console.log('Preparando archivo PDF para enviar al servidor:', file.name, 'tamaño:', (file.size / 1024).toFixed(2), 'KB');
    
    if (!validatePDF(file)) {
      throw new Error(`El archivo ${file.name} no es un PDF válido (tipo: ${file.type})`);
    }
    
    // Verificamos que el archivo no esté vacío
    if (file.size === 0) {
      throw new Error(`El archivo ${file.name} está vacío`);
    }
    
    // Verificamos que el tamaño no sea excesivo (límite de 15MB)
    const MAX_SIZE_MB = 15;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      throw new Error(`El archivo ${file.name} excede el tamaño máximo permitido de ${MAX_SIZE_MB}MB`);
    }
    
    console.log(`Archivo ${file.name} validado correctamente y listo para procesamiento en el servidor`);
    
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
 * y proporciona mensajes informativos
 */
export const hasPDFText = async (file: File): Promise<boolean> => {
  try {
    // Ahora solo verificamos si es un PDF válido
    const isValid = validatePDF(file);
    
    if (isValid) {
      console.log(`El archivo ${file.name} es un PDF válido y será procesado por Google Vision API en el servidor`);
    } else {
      console.warn(`El archivo ${file.name} no es un PDF válido y no puede ser procesado`);
    }
    
    return isValid;
  } catch (error) {
    console.error('Error verificando PDF:', error);
    return false;
  }
};
