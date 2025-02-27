
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

// Configuración de CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://cv-compatible-topmarket.lovable.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'true'
};

// Sistema de logging estructurado
enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  duration?: number;
  operation?: string;
}

class Logger {
  private context: Record<string, any> = {};
  private operationStartTime: number | null = null;
  private operationName: string | null = null;

  constructor(initialContext: Record<string, any> = {}) {
    this.context = initialContext;
  }

  withContext(additionalContext: Record<string, any>): Logger {
    return new Logger({...this.context, ...additionalContext});
  }

  startOperation(name: string): void {
    this.operationStartTime = performance.now();
    this.operationName = name;
    this.info(`Iniciando operación: ${name}`);
  }

  endOperation(): number | null {
    if (this.operationStartTime === null || this.operationName === null) {
      this.warn("Se intentó finalizar una operación que no se inició");
      return null;
    }

    const duration = performance.now() - this.operationStartTime;
    this.info(`Operación completada: ${this.operationName}`, { duration: `${duration.toFixed(2)}ms` });
    
    const opName = this.operationName;
    this.operationStartTime = null;
    this.operationName = null;
    
    return duration;
  }

  private log(level: LogLevel, message: string, additionalContext: Record<string, any> = {}): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {...this.context, ...additionalContext}
    };

    if (this.operationName) {
      entry.operation = this.operationName;
      if (this.operationStartTime) {
        entry.duration = performance.now() - this.operationStartTime;
      }
    }

    // Formato visual para consola
    const levelColor = {
      [LogLevel.DEBUG]: "\x1b[34m", // Azul
      [LogLevel.INFO]: "\x1b[32m",  // Verde
      [LogLevel.WARN]: "\x1b[33m",  // Amarillo
      [LogLevel.ERROR]: "\x1b[31m", // Rojo
    };
    
    const reset = "\x1b[0m";
    const levelStr = `${levelColor[level]}${level}${reset}`;
    const contextStr = Object.keys(entry.context || {}).length 
      ? `\n${JSON.stringify(entry.context, null, 2)}`
      : '';
    
    const durationStr = entry.duration 
      ? ` (${entry.duration.toFixed(2)}ms)` 
      : '';
    
    const operationStr = entry.operation 
      ? ` [${entry.operation}]` 
      : '';

    console.log(`[${entry.timestamp}] ${levelStr}${operationStr}${durationStr}: ${message}${contextStr}`);
    
    // Aquí se podría enviar los logs a un sistema externo (Datadog, Sentry, etc.)
    // o almacenarlos en una tabla de Supabase para análisis posterior
  }

  debug(message: string, context: Record<string, any> = {}): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context: Record<string, any> = {}): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context: Record<string, any> = {}): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context: Record<string, any> = {}): void {
    const errorContext = error ? {
      errorMessage: error.message,
      stack: error.stack,
      name: error.name
    } : {};
    
    this.log(LogLevel.ERROR, message, {...errorContext, ...context});
  }
}

// Extracción nativa de texto de PDF usando pdf-parse
async function extractTextNatively(fileData: string, logger: Logger): Promise<string> {
  const extractionLogger = logger.withContext({ 
    method: 'extractTextNatively', 
    fileSize: Math.round(fileData.length * 0.75 / 1024) + 'KB' // Estimación del tamaño descodificado
  });
  extractionLogger.startOperation('extraccion_nativa_pdf');
  
  try {
    extractionLogger.debug('Iniciando extracción nativa de texto del PDF');
    
    // Convertir base64 a ArrayBuffer
    const binaryString = atob(fileData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    extractionLogger.debug('Base64 convertido a ArrayBuffer', { byteLength: bytes.length });
    
    // Importar pdf-parse (ESM no soporta require, así que usamos dynamic import)
    const importStartTime = performance.now();
    extractionLogger.debug('Importando módulo pdf-parse');
    const pdfParse = await import('https://esm.sh/pdf-parse@1.1.1');
    extractionLogger.debug('Módulo pdf-parse importado', { 
      importDuration: `${(performance.now() - importStartTime).toFixed(2)}ms` 
    });
    
    extractionLogger.info('Procesando PDF con pdf-parse...');
    const parseStartTime = performance.now();
    const data = await pdfParse.default(bytes.buffer);
    const parseDuration = performance.now() - parseStartTime;
    
    // Verificar que el texto sea significativo
    const extractedText = data.text || '';
    extractionLogger.info(`Texto extraído del PDF`, { 
      charCount: extractedText.length,
      pageCount: data.numpages || 'desconocido',
      parseDuration: `${parseDuration.toFixed(2)}ms`,
      parseSpeed: `${((bytes.length / 1024) / (parseDuration / 1000)).toFixed(2)} KB/s`
    });
    
    // Si tenemos texto significativo (más de 100 caracteres)
    if (extractedText.length > 100) {
      extractionLogger.info('Extracción nativa exitosa', { 
        textSample: extractedText.substring(0, 100) + '...' 
      });
      extractionLogger.endOperation();
      return extractedText;
    }
    
    extractionLogger.warn('El texto extraído es insuficiente, se usará OCR como respaldo', { 
      charCount: extractedText.length,
      threshold: 100
    });
    extractionLogger.endOperation();
    return '';
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    extractionLogger.error('Error en extracción nativa de texto', err, {
      errorType: err.name,
      message: err.message
    });
    extractionLogger.endOperation();
    return '';
  }
}

async function performOCR(fileData: string, logger: Logger, retryCount = 0): Promise<string> {
  const ocrLogger = logger.withContext({ 
    method: 'performOCR', 
    retryCount,
    fileSize: Math.round(fileData.length * 0.75 / 1024) + 'KB' // Estimación del tamaño descodificado
  });
  ocrLogger.startOperation('ocr_google_vision');
  
  try {
    ocrLogger.info('Iniciando OCR con Google Vision API');
    const credentials = JSON.parse(Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS') || '{}');
    
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('Credenciales de Google Cloud Vision incompletas o no configuradas');
    }
    
    ocrLogger.debug('Obteniendo token de acceso para Google Vision API');
    const tokenStartTime = performance.now();
    const accessToken = await getAccessToken(credentials);
    ocrLogger.debug('Token de acceso obtenido', { 
      tokenObtainDuration: `${(performance.now() - tokenStartTime).toFixed(2)}ms` 
    });

    // Dividir el documento en segmentos si es grande (límite de 10MB por request)
    const maxBytes = 10485760; // 10MB
    const segments = [];
    let start = 0;
    
    while (start < fileData.length) {
      segments.push(fileData.slice(start, start + maxBytes));
      start += maxBytes;
    }

    ocrLogger.info(`Documento dividido para procesamiento OCR`, { 
      segmentCount: segments.length,
      segmentSize: segments.length > 0 ? Math.round(segments[0].length * 0.75 / 1024) + 'KB' : '0KB'
    });
    
    let fullText = '';
    const segmentMetrics = [];

    for (let i = 0; i < segments.length; i++) {
      const segmentLogger = ocrLogger.withContext({ segmentIndex: i, segmentTotal: segments.length });
      segmentLogger.info(`Procesando segmento ${i + 1}/${segments.length}`);
      
      const segmentStartTime = performance.now();
      const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [{
            image: { content: segments[i] },
            features: [{ 
              type: 'DOCUMENT_TEXT_DETECTION',
              maxResults: 1
            }]
          }]
        })
      });

      if (!response.ok) {
        const error = await response.json();
        segmentLogger.error('Error en la respuesta de Vision API', null, {
          statusCode: response.status,
          statusText: response.statusText,
          errorDetails: error
        });
        
        if (retryCount < 3 && (response.status === 429 || response.status >= 500)) {
          const delay = Math.pow(2, retryCount) * 1000;
          segmentLogger.warn(`Reintentando OCR después de backoff exponencial`, { 
            delay: `${delay}ms`,
            nextRetryCount: retryCount + 1 
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          return performOCR(fileData, logger, retryCount + 1);
        }
        
        throw new Error(`Error en Vision API: ${error.error?.message || `Código ${response.status}`}`);
      }

      const result = await response.json();
      const segmentDuration = performance.now() - segmentStartTime;
      const textAnnotation = result.responses[0]?.fullTextAnnotation;
      
      if (textAnnotation?.text) {
        const segmentText = textAnnotation.text;
        fullText += segmentText + ' ';
        
        segmentLogger.info(`Texto extraído del segmento ${i + 1}`, { 
          charCount: segmentText.length,
          processingTime: `${segmentDuration.toFixed(2)}ms`,
          textSample: segmentText.substring(0, 100) + (segmentText.length > 100 ? '...' : '')
        });
        
        segmentMetrics.push({
          index: i,
          charCount: segmentText.length,
          durationMs: segmentDuration,
          charPerSec: (segmentText.length / (segmentDuration / 1000)).toFixed(2)
        });
      } else {
        segmentLogger.warn(`No se encontró texto en el segmento ${i + 1}`, {
          processingTime: `${segmentDuration.toFixed(2)}ms`,
          response: result.responses[0]
        });
        segmentMetrics.push({
          index: i,
          charCount: 0,
          durationMs: segmentDuration,
          charPerSec: '0'
        });
      }
    }

    const extractedText = fullText.trim();
    const totalDuration = ocrLogger.endOperation() || 0;
    
    if (!extractedText) {
      ocrLogger.warn('No se encontró texto en ningún segmento del documento');
      return '';
    }

    ocrLogger.info('OCR completado exitosamente', { 
      totalCharacters: extractedText.length,
      totalSegments: segments.length,
      processingTimeMs: totalDuration.toFixed(2),
      averageCharPerSec: ((extractedText.length / (totalDuration / 1000)) || 0).toFixed(2),
      segmentMetrics
    });
    
    return extractedText;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    ocrLogger.error('Error detallado en OCR', err, {
      stack: err.stack,
      retryCount
    });
    ocrLogger.endOperation();
    throw err;
  }
}

async function getAccessToken(credentials: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: 'https://vision.googleapis.com/',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-vision'
  };

  const key = await crypto.subtle.importKey(
    'pkcs8',
    new TextEncoder().encode(credentials.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const jwt = await create({ alg: 'RS256', typ: 'JWT' }, payload, key);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// Métricas y monitoreo
interface ProcessingMetrics {
  documentId: string;
  startTime: number;
  endTime?: number;
  filename: string;
  fileType: string;
  fileSize: number;
  extractionMethod: string;
  success: boolean;
  textLength?: number;
  processingTimeMs?: number;
  error?: string;
}

// Función principal de procesamiento
serve(async (req) => {
  // Crear logger con identificador único de request
  const requestId = crypto.randomUUID();
  const logger = new Logger({ requestId });
  logger.startOperation('process_document');
  
  // Almacenar métricas
  const metrics: ProcessingMetrics = {
    documentId: '',
    startTime: Date.now(),
    filename: '',
    fileType: '',
    fileSize: 0,
    extractionMethod: 'pending',
    success: false
  };

  if (req.method === 'OPTIONS') {
    logger.debug('Recibida solicitud OPTIONS (CORS preflight)');
    return new Response(null, { 
      status: 204, 
      headers: corsHeaders 
    });
  }

  // Crear cliente Supabase una sola vez
  let supabaseClient: any = null;
  
  try {
    logger.info('Iniciando procesamiento de documento');
    
    // Extraer y validar datos de entrada
    let reqBody: any;
    try {
      reqBody = await req.json();
      logger.debug('Request body recibido y parseado');
    } catch (error) {
      logger.error('Error al parsear el cuerpo de la solicitud', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Error al parsear el cuerpo de la solicitud');
    }
    
    const { filename, contentType, fileData } = reqBody;
    
    if (!fileData) {
      logger.error('Datos de archivo faltantes', null, { missingField: 'fileData' });
      throw new Error('Se requiere fileData');
    }
    
    if (!filename) {
      logger.error('Datos de archivo faltantes', null, { missingField: 'filename' });
      throw new Error('Se requiere filename');
    }
    
    if (!contentType) {
      logger.error('Datos de archivo faltantes', null, { missingField: 'contentType' });
      throw new Error('Se requiere contentType');
    }
    
    // Actualizar métricas con información del archivo
    metrics.filename = filename;
    metrics.fileType = contentType;
    metrics.fileSize = Math.round(fileData.length * 0.75); // Estimación del tamaño real (base64 es ~33% más grande)
    
    logger.info('Archivo recibido para procesamiento', { 
      filename, 
      contentType, 
      fileSize: `${Math.round(metrics.fileSize / 1024)} KB` 
    });

    // Inicializar cliente Supabase
    logger.debug('Inicializando cliente Supabase');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      logger.error('Variables de entorno de Supabase no configuradas');
      throw new Error('Configuración de Supabase incompleta');
    }
    
    supabaseClient = createClient(supabaseUrl, supabaseKey);
    
    // Crear registro en la base de datos
    logger.info('Creando registro en la base de datos');
    const filePath = `documents/${filename.toLowerCase().replace(/[^a-z0-9]/g, '_')}-${crypto.randomUUID()}.${filename.split('.').pop()}`;
    
    const { data: document, error: insertError } = await supabaseClient
      .from('documents')
      .insert({
        filename,
        content_type: contentType,
        status: 'processing',
        file_path: filePath
      })
      .select()
      .single();

    if (insertError) {
      logger.error('Error al crear registro en la base de datos', null, { error: insertError });
      throw insertError;
    }
    
    // Actualizar métricas con ID del documento
    metrics.documentId = document.id;
    logger.info('Registro creado en base de datos', { documentId: document.id, filePath });

    let extractedText = '';
    
    // Estrategia en capas para extracción de texto
    if (contentType.includes('pdf') || contentType === 'application/pdf') {
      logger.info('Iniciando estrategia de procesamiento para PDF');
      logger.debug('Intentando extracción nativa primero...');
      
      const nativeExtractionStartTime = performance.now();
      extractedText = await extractTextNatively(fileData, logger);
      const nativeExtractionDuration = performance.now() - nativeExtractionStartTime;
      
      // Si falla la extracción nativa o no hay suficiente texto, usar OCR como respaldo
      if (!extractedText || extractedText.length < 100) {
        logger.info('Extracción nativa no efectiva, cambiando a OCR como respaldo', {
          nativeExtractionDuration: `${nativeExtractionDuration.toFixed(2)}ms`,
          extractedChars: extractedText.length
        });
        
        metrics.extractionMethod = 'ocr_fallback';
        extractedText = await performOCR(fileData, logger);
      } else {
        logger.info('Extracción nativa exitosa, no se requiere OCR', {
          extractionTime: `${nativeExtractionDuration.toFixed(2)}ms`,
          charCount: extractedText.length
        });
        metrics.extractionMethod = 'native_pdf';
      }
    } else {
      // Para otros formatos (imágenes), usar OCR directamente
      logger.info('Documento no es PDF, procesando directamente con OCR', { contentType });
      metrics.extractionMethod = 'ocr_direct';
      extractedText = await performOCR(fileData, logger);
    }
    
    // Procesar resultado
    logger.info('Procesamiento de texto completado', { 
      extractionMethod: metrics.extractionMethod,
      textLength: extractedText.length
    });
    
    const finalText = extractedText.trim() || 'No se pudo extraer texto';
    metrics.textLength = finalText.length;
    
    // Actualizar registro en la base de datos
    logger.info('Actualizando registro con texto extraído', { documentId: document.id });
    const { error: updateError } = await supabaseClient
      .from('documents')
      .update({
        processed_text: finalText,
        status: 'processed',
        processed_at: new Date().toISOString()
      })
      .eq('id', document.id);

    if (updateError) {
      logger.error('Error al actualizar registro', null, { error: updateError });
      throw updateError;
    }
    
    // Subir archivo a Storage
    logger.info('Subiendo archivo a Storage', { bucket: 'cv_uploads', filePath });
    const fileBytes = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));
    
    const { error: storageError } = await supabaseClient.storage
      .from('cv_uploads')
      .upload(document.file_path, fileBytes, {
        contentType,
        upsert: false
      });

    if (storageError) {
      logger.error('Error al subir archivo a Storage', null, { error: storageError });
      throw storageError;
    }

    const { data: { publicUrl } } = supabaseClient.storage
      .from('cv_uploads')
      .getPublicUrl(document.file_path);
      
    // Finalizar métricas
    metrics.endTime = Date.now();
    metrics.processingTimeMs = metrics.endTime - metrics.startTime;
    metrics.success = true;
    
    // Registrar métricas de procesamiento completo
    logger.info('Procesamiento completado exitosamente', { 
      documentId: document.id,
      processingTimeMs: metrics.processingTimeMs,
      extractionMethod: metrics.extractionMethod,
      textLength: metrics.textLength
    });
    
    // Opcional: Guardar métricas en una tabla de analíticas
    try {
      await supabaseClient
        .from('document_processing_metrics')
        .insert({
          document_id: metrics.documentId,
          extraction_method: metrics.extractionMethod,
          processing_time_ms: metrics.processingTimeMs,
          file_size_bytes: metrics.fileSize,
          text_length: metrics.textLength,
          success: metrics.success
        })
        .select();
      logger.debug('Métricas de procesamiento guardadas en la base de datos');
    } catch (error) {
      // No es crítico si esto falla, solo lo registramos
      logger.warn('No se pudieron guardar las métricas de procesamiento', { error });
    }
    
    // Finalizar operación principal
    logger.endOperation();
    
    // Retornar respuesta
    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: document.id,
          filename: document.filename,
          status: 'processed',
          file_path: document.file_path,
          public_url: publicUrl,
          extracted_text: finalText,
          processing_time_ms: metrics.processingTimeMs,
          extraction_method: metrics.extractionMethod
        }
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    // Capturar métricas de error
    metrics.endTime = Date.now();
    metrics.processingTimeMs = metrics.endTime - metrics.startTime;
    metrics.success = false;
    metrics.error = error instanceof Error ? error.message : String(error);
    
    // Registrar error
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Error en process-document', err, {
      stack: err.stack,
      metrics
    });
    
    // Intentar guardar métricas de error si tenemos cliente Supabase
    if (supabaseClient && metrics.documentId) {
      try {
        await supabaseClient
          .from('document_processing_metrics')
          .insert({
            document_id: metrics.documentId,
            extraction_method: metrics.extractionMethod,
            processing_time_ms: metrics.processingTimeMs,
            file_size_bytes: metrics.fileSize,
            text_length: 0,
            success: false,
            error_message: metrics.error
          });
        logger.debug('Métricas de error guardadas en la base de datos');
      } catch (metricError) {
        logger.warn('No se pudieron guardar las métricas de error', { error: metricError });
      }
      
      // Actualizar documento con estado de error
      try {
        await supabaseClient
          .from('documents')
          .update({
            status: 'error',
            error: metrics.error
          })
          .eq('id', metrics.documentId);
        logger.debug('Estado del documento actualizado a error');
      } catch (updateError) {
        logger.warn('No se pudo actualizar el estado del documento a error', { error: updateError });
      }
    }
    
    logger.endOperation();
    
    return new Response(
      JSON.stringify({ 
        error: 'Error procesando documento', 
        details: metrics.error,
        requestId
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
