
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { withRetry, defaultRetryConfig } from "@/utils/retryUtils";
import { validatePDF } from "@/utils/PDFProcessor";

interface UploadZoneProps {
  onFilesAccepted: (files: File[], processedData?: any) => void;
}

const UploadZone = ({ onFilesAccepted }: UploadZoneProps) => {
  const { toast } = useToast();

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          // Eliminar el prefijo "data:*/*;base64," del resultado
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        } else {
          reject(new Error('Error al convertir el archivo a base64'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  const processFile = async (file: File) => {
    console.log('Iniciando procesamiento del archivo:', file.name, 'tipo:', file.type, 'tamaño:', file.size);
    
    try {
      // Para PDFs, solo validamos que sea un archivo PDF válido
      if (file.type === 'application/pdf') {
        if (!validatePDF(file)) {
          throw new Error('El archivo no es un PDF válido');
        }
        console.log('PDF validado, enviando al servidor para procesamiento');
      }
      
      // Convertir el archivo a base64
      const base64File = await fileToBase64(file);
      console.log('Archivo convertido a base64, enviando a process-document...');

      // Enviamos el archivo en base64 junto con metadata
      const { data, error } = await withRetry(
        async () => {
          return await supabase.functions.invoke('process-document', {
            method: 'POST',
            body: {
              filename: file.name,
              contentType: file.type,
              fileData: base64File,
              useGoogleVision: true // Indicamos que use Google Vision API para todos los archivos
            }
          });
        },
        defaultRetryConfig,
        (attempt, error) => {
          console.log(`Reintento ${attempt} al procesar ${file.name}:`, error);
          if (attempt === defaultRetryConfig.maxRetries) {
            toast({
              title: "Error después de varios intentos",
              description: `No se pudo procesar el archivo ${file.name} después de ${defaultRetryConfig.maxRetries} intentos.`,
              variant: "destructive"
            });
          } else {
            toast({
              title: `Reintentando (${attempt}/${defaultRetryConfig.maxRetries})`,
              description: `Hubo un problema al procesar ${file.name}. Reintentando...`
            });
          }
        }
      );

      if (error) {
        console.error('Error invocando la función:', error);
        throw error;
      }

      console.log('Respuesta de process-document:', data);

      if (!data?.document?.id) {
        console.error('No se recibió document.id en la respuesta');
        throw new Error('No se recibió ID del documento');
      }

      toast({
        title: "Archivo procesado exitosamente",
        description: `Se ha procesado el archivo ${file.name}`,
      });

      return data;
    } catch (error) {
      console.error('Error procesando archivo:', error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace disponible');
      
      toast({
        title: "Error al procesar el archivo",
        description: error instanceof Error ? error.message : "Hubo un problema al procesar el archivo. Por favor, intenta nuevamente.",
        variant: "destructive"
      });
      throw error;
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    console.log('Archivos recibidos en onDrop:', acceptedFiles.map(f => ({
      nombre: f.name,
      tipo: f.type,
      tamaño: f.size
    })));
    
    for (const file of acceptedFiles) {
      try {
        console.log('Procesando archivo:', file.name);
        const processedData = await processFile(file);
        console.log('Datos procesados para', file.name, ':', processedData);
        onFilesAccepted([file], processedData);
      } catch (error) {
        console.error(`Error procesando archivo ${file.name}:`, error);
        console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace disponible');
      }
    }
  }, [onFilesAccepted]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg']
    },
    multiple: true
  });

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
        transition-all duration-200 ease-in-out
        ${isDragActive 
          ? 'border-blue-500 bg-blue-50' 
          : 'border-gray-300 hover:border-gray-400 bg-white'
        }
      `}
    >
      <input {...getInputProps()} />
      <motion.div
        initial={{ scale: 1 }}
        animate={{ scale: isDragActive ? 1.05 : 1 }}
        className="flex flex-col items-center justify-center space-y-4"
      >
        <Upload 
          className={`h-12 w-12 ${
            isDragActive ? 'text-blue-500' : 'text-gray-400'
          }`}
        />
        <div className="space-y-2">
          <p className="text-lg font-medium text-gray-700">
            {isDragActive 
              ? "Suelta los archivos aquí" 
              : "Arrastra y suelta los archivos aquí"
            }
          </p>
          <p className="text-sm text-gray-500">
            o haz clic para buscar
          </p>
          <p className="text-xs text-gray-400">
            Formatos soportados: PDF, DOC, DOCX, PNG, JPG
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default UploadZone;
