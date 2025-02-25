
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, FileType } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { processPDF, validatePDF } from "@/utils/PDFProcessor";

export default function UploadCV() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const selectedFile = event.target.files[0];
      if (selectedFile.size > 10 * 1024 * 1024) { // 10MB limit
        toast({
          title: "Archivo demasiado grande",
          description: "El archivo no debe superar los 10MB",
          variant: "destructive"
        });
        return;
      }
      setFile(selectedFile);
    }
  };

  const processFile = async (file: File): Promise<string> => {
    try {
      // Si es PDF, primero intentamos extraer texto con pdf.js
      if (file.type === 'application/pdf') {
        const isValidPDF = await validatePDF(file);
        if (!isValidPDF) {
          throw new Error('El archivo PDF no es válido o está dañado');
        }

        const pdfText = await processPDF(file);
        if (pdfText) {
          console.log('Texto extraído del PDF:', pdfText.substring(0, 100) + '...');
          return pdfText;
        }
        console.log('PDF no contiene texto seleccionable, procesando como imagen...');
      }

      // Convert file to base64 for OCR processing
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            const base64Data = reader.result.split(',')[1];
            resolve(base64Data);
          } else {
            reject(new Error('Failed to convert file to base64'));
          }
        };
        reader.onerror = () => reject(reader.error);
      });

      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      // Call the process-document function for OCR
      const { data, error } = await supabase.functions.invoke('process-document', {
        body: {
          filename: file.name,
          contentType: file.type,
          fileData: base64Data
        }
      });

      if (error) throw error;

      console.log('Respuesta del procesamiento OCR:', data);
      return data.document.id;

    } catch (error) {
      console.error('Error procesando archivo:', error);
      throw error;
    }
  };

  const handleProcessFile = async () => {
    if (!file) {
      toast({
        title: "No hay archivo",
        description: "Por favor, selecciona un archivo primero.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Validar tipo de archivo
      if (!file.type.match(/(application\/pdf|image\/(png|jpe?g))/)) {
        throw new Error('Formato no soportado. Use PDF, PNG o JPG.');
      }

      const result = await processFile(file);
      
      toast({
        title: "Archivo procesado exitosamente",
        description: "El documento está siendo analizado. Los resultados estarán disponibles en breve.",
      });

      // Limpiar el formulario
      setFile(null);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (input) input.value = '';

    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "Error al procesar el archivo",
        description: error instanceof Error ? error.message : "Ocurrió un error inesperado",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6 p-6 bg-white rounded-lg shadow-sm border">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Sube tu CV</h2>
        <p className="text-sm text-muted-foreground">
          Formatos soportados: PDF, PNG, JPG
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid w-full max-w-sm items-center gap-1.5">
          <Input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={handleFileChange}
            disabled={isProcessing}
            className="cursor-pointer"
          />
          {file && (
            <p className="text-sm text-muted-foreground">
              Archivo seleccionado: {file.name}
            </p>
          )}
        </div>

        <Button
          className="w-full"
          onClick={handleProcessFile}
          disabled={!file || isProcessing}
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Procesando...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Procesar CV
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
