
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface UploadZoneProps {
  onFilesAccepted: (files: File[]) => void;
}

const UploadZone = ({ onFilesAccepted }: UploadZoneProps) => {
  const { toast } = useToast();

  const processFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const { data, error } = await supabase.functions.invoke('process-document', {
        body: formData,
      });

      if (error) throw error;

      toast({
        title: "Archivo procesado exitosamente",
        description: `Se ha procesado el archivo ${file.name}`,
      });

      return data;
    } catch (error) {
      console.error('Error processing file:', error);
      toast({
        title: "Error al procesar el archivo",
        description: "Hubo un problema al procesar el archivo. Por favor, intenta nuevamente.",
        variant: "destructive"
      });
      throw error;
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const processedFiles = [];
    for (const file of acceptedFiles) {
      try {
        await processFile(file);
        processedFiles.push(file);
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
      }
    }
    
    if (processedFiles.length > 0) {
      onFilesAccepted(processedFiles);
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
