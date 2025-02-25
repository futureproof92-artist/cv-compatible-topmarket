
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileText, Upload, FileSearch, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { processPDF, validatePDF } from '@/utils/PDFProcessor';
import { processImage, validateImage, validateImageSize } from '@/utils/ImageProcessor';

interface ProcessingResult {
  text: string;
  source: 'pdf' | 'image';
}

const UploadCV = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const { toast } = useToast();

  const processFile = async (file: File) => {
    setIsProcessing(true);
    try {
      let extractedText = '';
      let source: 'pdf' | 'image' = 'pdf';

      if (file.type === 'application/pdf') {
        console.log('Procesando PDF:', file.name);
        if (await validatePDF(file)) {
          extractedText = await processPDF(file);
          
          // Si no se encontró texto en el PDF, intenta procesarlo como imagen
          if (!extractedText) {
            console.log('PDF sin texto encontrado, intentando OCR...');
            extractedText = await processImage(file);
            source = 'image';
          }
        } else {
          throw new Error('El archivo PDF no es válido');
        }
      } else if (validateImage(file)) {
        console.log('Procesando imagen:', file.name);
        if (validateImageSize(file)) {
          extractedText = await processImage(file);
          source = 'image';
        } else {
          throw new Error('La imagen excede el tamaño máximo permitido (10MB)');
        }
      } else {
        throw new Error('Formato de archivo no soportado');
      }

      setResult({ text: extractedText, source });
      toast({
        title: "Archivo procesado exitosamente",
        description: `Se ha extraído el texto del ${source === 'pdf' ? 'PDF' : 'imagen'}`
      });

    } catch (error) {
      console.error('Error procesando archivo:', error);
      toast({
        title: "Error al procesar el archivo",
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive"
      });
      setResult(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    const file = acceptedFiles[0];
    await processFile(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg']
    },
    multiple: false
  });

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div 
        {...getRootProps()} 
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-all duration-200 ease-in-out
          ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
        `}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center space-y-4">
          <Upload 
            className={`h-12 w-12 ${
              isDragActive ? 'text-blue-500' : 'text-gray-400'
            }`}
          />
          <div className="space-y-2">
            <p className="text-lg font-medium text-gray-700">
              {isDragActive 
                ? "Suelta el archivo aquí" 
                : "Arrastra y suelta el archivo aquí"
              }
            </p>
            <p className="text-sm text-gray-500">
              o haz clic para buscar
            </p>
            <p className="text-xs text-gray-400">
              Formatos soportados: PDF, PNG, JPG
            </p>
          </div>
        </div>
      </div>

      {isProcessing && (
        <div className="mt-6 text-center">
          <div className="flex items-center justify-center space-x-2">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            <span className="text-gray-600">Procesando archivo...</span>
          </div>
        </div>
      )}

      {result && !isProcessing && (
        <div className="mt-6 p-4 bg-white rounded-lg border">
          <div className="flex items-center space-x-2 mb-3">
            {result.source === 'pdf' ? (
              <FileText className="h-5 w-5 text-blue-500" />
            ) : (
              <FileSearch className="h-5 w-5 text-green-500" />
            )}
            <h3 className="text-lg font-medium">
              Texto Extraído ({result.source === 'pdf' ? 'PDF' : 'OCR'})
            </h3>
          </div>
          <div className="max-h-60 overflow-y-auto">
            <p className="text-gray-700 whitespace-pre-wrap">
              {result.text || 'No se encontró texto en el archivo'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadCV;
