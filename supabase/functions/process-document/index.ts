
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.189/build/pdf.min.mjs";

// Configurar GlobalWorkerOptions al inicio para evitar errores
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Manejo de CORS para solicitudes OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
      status: 204,
    });
  }

  try {
    const reqData = await req.json();
    
    const { filename, contentType, fileData, disableWorker } = reqData;
    
    console.log(`Procesando archivo: ${filename}, tipo: ${contentType}, disableWorker: ${disableWorker}`);

    if (!fileData) {
      throw new Error("No se proporcionaron datos del archivo");
    }

    // Creamos el cliente de Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Generamos un file_path único para el documento
    // Esto es necesario porque file_path es un campo NOT NULL en la tabla documents
    const fileExt = filename.split('.').pop() || '';
    const filePath = `${crypto.randomUUID()}.${fileExt}`;

    // Insertamos el documento en la base de datos usando uno de los valores permitidos para status:
    // 'pending', 'processing', 'processed', 'error'
    const { data: document, error } = await supabase
      .from('documents')
      .insert({
        filename,
        file_path: filePath,
        content_type: contentType,
        status: 'pending'  // Cambiado de 'uploaded' a 'pending' para cumplir con la restricción
      })
      .select()
      .single();

    if (error) {
      console.error('Error insertando documento:', error);
      throw error;
    }

    console.log(`Documento insertado con ID: ${document.id}`);

    // Iniciamos el procesamiento del texto en segundo plano
    // Pasamos fileData como variable en memoria en lugar de almacenarlo en la BD
    processDocumentText(document.id, fileData, contentType, supabase, disableWorker).catch(error => {
      console.error(`Error procesando texto del documento ${document.id}:`, error);
    });

    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: document.id,
          filename: document.filename,
          file_path: document.file_path,
          contentType: document.content_type,
          status: document.status
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error en process-document:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Error desconocido"
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

async function processDocumentText(documentId: string, fileData: string, contentType: string, supabase: any, disableWorker?: boolean) {
  try {
    console.log(`Iniciando procesamiento de texto para documento ${documentId}`);
    
    // Actualizamos el estado del documento a 'processing'
    await supabase
      .from('documents')
      .update({ status: 'processing' })
      .eq('id', documentId);
    
    let processedText = '';
    
    // Procesamos según el tipo de contenido
    if (contentType.includes('pdf')) {
      console.log('Procesando PDF...');
      processedText = await extractTextFromPdf(fileData, disableWorker);
    } else if (contentType.includes('image')) {
      console.log('Procesando imagen...');
      processedText = await extractTextFromImage(fileData);
    } else if (contentType.includes('word')) {
      console.log('Procesando documento Word...');
      // Placeholder para procesamiento de documentos Word
      processedText = "Procesamiento de documentos Word no implementado aún";
    } else {
      console.log(`Tipo de contenido no soportado: ${contentType}`);
      throw new Error(`Tipo de contenido no soportado: ${contentType}`);
    }
    
    console.log(`Texto extraído para documento ${documentId} (primeros 100 caracteres): ${processedText.substring(0, 100)}...`);
    
    // Verificación para satisfacer la restricción de longitud de processed_text
    if (!processedText || processedText.trim().length === 0) {
      throw new Error("No se pudo extraer texto del documento");
    }
    
    // Actualizamos el documento con el texto procesado
    const { error } = await supabase
      .from('documents')
      .update({
        processed_text: processedText,
        status: 'processed',
        processed_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    if (error) {
      console.error('Error actualizando documento con texto procesado:', error);
      throw error;
    }
    
    console.log(`Procesamiento de texto completado para documento ${documentId}`);
  } catch (error) {
    console.error(`Error en processDocumentText para documento ${documentId}:`, error);
    
    // Actualizamos el estado del documento a 'error'
    await supabase
      .from('documents')
      .update({
        status: 'error',
        error: error.message || "Error desconocido en procesamiento de texto"
      })
      .eq('id', documentId);
    
    throw error;
  }
}

async function extractTextFromPdf(base64Data: string, disableWorker?: boolean) {
  try {
    console.log('Iniciando extracción de texto con pdfjs-dist...');
    
    // Decodificamos los datos base64 a un array de bytes
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Configuramos las opciones para cargar el PDF con todas las opciones necesarias
    // para deshabilitar completamente el worker
    const pdfOptions = {
      data: bytes,
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      standardFontDataUrl: null,
      workerSrc: null
    };
    
    console.log('Cargando documento PDF con opciones para deshabilitar worker');
    const loadingTask = pdfjsLib.getDocument(pdfOptions);
    const pdf = await loadingTask.promise;
    console.log(`PDF cargado. Número de páginas: ${pdf.numPages}`);
    
    let fullText = '';
    
    // Extraemos el texto de cada página
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      console.log(`Procesando página ${pageNum}/${pdf.numPages}...`);
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      
      // Concatenamos el texto de todos los elementos de texto en la página
      const pageText = content.items
        .map((item: any) => item.str)
        .join(' ');
      
      fullText += pageText + '\n\n';
    }
    
    console.log(`Extracción de texto completada. Longitud: ${fullText.length} caracteres`);
    
    // Si el texto está vacío o es demasiado corto, podría indicar un problema con el PDF
    if (fullText.length < 50) {
      console.log('El texto extraído es muy corto, posiblemente un PDF escaneado o con imagen.');
      throw new Error('El PDF parece no contener texto extraíble. Posiblemente es un PDF escaneado o basado en imágenes.');
    }
    
    return fullText;
  } catch (error) {
    console.error('Error en extracción de texto con pdfjs-dist:', error);
    
    // Para PDFs escaneados o con problemas, intentamos usar OCR como fallback
    console.log('Intentando extracción con OCR como fallback...');
    return await extractTextFromImage(base64Data);
  }
}

async function extractTextFromImage(base64Data: string) {
  try {
    console.log('Iniciando extracción de texto de imagen con Vision API...');
    
    // Obtenemos las credenciales de Google Cloud Vision
    const credentialsString = Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS');
    if (!credentialsString) {
      throw new Error('No se encontraron credenciales para Google Cloud Vision');
    }
    
    // Parseamos las credenciales
    const credentials = JSON.parse(credentialsString);
    
    // Obtenemos un token de acceso
    console.log('Obteniendo token de acceso...');
    const tokenResponse = await fetch(
      `https://oauth2.googleapis.com/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: await createJWT(credentials),
        }),
      }
    );
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('Error obteniendo token de acceso:', tokenData);
      throw new Error('No se pudo obtener token de acceso para Vision API');
    }
    
    console.log('Access token obtenido exitosamente');
    
    // Realizamos la solicitud a la API de Vision
    console.log('Enviando solicitud a Vision API...');
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: base64Data,
              },
              features: [
                {
                  type: 'TEXT_DETECTION',
                  maxResults: 1,
                },
              ],
            },
          ],
        }),
      }
    );
    
    const visionData = await visionResponse.json();
    
    if (!visionResponse.ok || !visionData.responses || visionData.responses.length === 0) {
      console.error('Error en respuesta de Vision API:', visionData);
      throw new Error('Error al procesar la imagen con Vision API');
    }
    
    console.log('Respuesta de Vision API recibida');
    
    // Extraemos el texto de la respuesta
    const textAnnotation = visionData.responses[0].fullTextAnnotation;
    
    if (!textAnnotation) {
      console.log('No se encontró texto en la imagen');
      return '';
    }
    
    console.log(`Texto extraído de la imagen. Longitud: ${textAnnotation.text.length} caracteres`);
    return textAnnotation.text;
  } catch (error) {
    console.error('Error en extractTextFromImage:', error);
    throw new Error(`Error procesando imagen: ${error.message}`);
  }
}

async function createJWT(credentials: any) {
  // Implementación simple de JWT para autenticación de Google Cloud
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: credentials.private_key_id,
  };
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };
  
  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  
  // Importamos la clave privada para firmar
  const privateKey = credentials.private_key;
  const keyData = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');
  
  const binaryKey = atob(keyData);
  const len = binaryKey.length;
  const keyBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    keyBytes[i] = binaryKey.charCodeAt(i);
  }
  
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } };
  const extractable = false;
  const keyUsages = ['sign'] as KeyUsage[];
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    algorithm,
    extractable,
    keyUsages
  );
  
  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    algorithm.name,
    cryptoKey,
    encoder.encode(signatureInput)
  );
  
  const signatureArray = new Uint8Array(signatureBuffer);
  let signature = '';
  for (let i = 0; i < signatureArray.length; i++) {
    signature += String.fromCharCode(signatureArray[i]);
  }
  
  const encodedSignature = btoa(signature)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  return `${signatureInput}.${encodedSignature}`;
}
