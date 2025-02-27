import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Upload, Check, X, Search, Loader2, FileSearch } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import UploadZone from '@/components/UploadZone';
import RequirementsForm from '@/components/RequirementsForm';
import { withRetry, defaultRetryConfig } from '@/utils/retryUtils';

const Index = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [requirements, setRequirements] = useState({
    title: '',
    skills: [],
    experience: '',
    location: '',
    education: ''
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any>(null);
  const { toast } = useToast();
  const [processedTexts, setProcessedTexts] = useState<{[key: string]: string}>({});
  const [loadingTexts, setLoadingTexts] = useState<{[key: string]: boolean}>({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [documentIds, setDocumentIds] = useState<{[key: string]: string}>({});
  const [retryAttempts, setRetryAttempts] = useState<{[key: string]: number}>({});

  const handleFilesAccepted = useCallback((acceptedFiles: File[], processedData?: any) => {
    const newFiles = acceptedFiles.filter(file => 
      !files.some(existingFile => existingFile.name === file.name)
    );

    if (newFiles.length === 0) {
      toast({
        title: "Archivos duplicados",
        description: "Los archivos ya han sido agregados.",
        variant: "destructive"
      });
      return;
    }

    newFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64String = (reader.result as string).split(',')[1];
        
        try {
          console.log('Enviando archivo a procesar:', file.name);
          
          const processDocument = async () => {
            const { data, error } = await supabase.functions.invoke('process-document', {
              body: {
                filename: file.name,
                contentType: file.type,
                fileData: base64String
              }
            });
            
            if (error) throw error;
            return data;
          };

          const data = await withRetry(
            processDocument,
            defaultRetryConfig,
            (attempt, error) => {
              console.log(`Reintento ${attempt} para ${file.name}:`, error);
              setRetryAttempts(prev => ({
                ...prev,
                [file.name]: attempt
              }));
              toast({
                title: `Reintentando proceso (${attempt}/3)`,
                description: `Reintentando procesar ${file.name}...`,
              });
            }
          );

          console.log('Respuesta del procesamiento:', data);
          
          if (data?.document?.id) {
            const documentId = data.document.id;
            setDocumentIds(prev => ({
              ...prev,
              [file.name]: documentId
            }));
            
            setLoadingTexts(prev => ({...prev, [documentId]: true}));
            setUploadProgress(10);
            
            let attempts = 0;
            const maxAttempts = 30;
            
            const pollDocument = async () => {
              const { data: docData, error: docError } = await supabase
                .from('documents')
                .select('processed_text, status')
                .eq('id', documentId)
                .single();
              
              if (docError) throw docError;
              return docData;
            };

            const poll = async () => {
              while (attempts < maxAttempts) {
                try {
                  const docData = await withRetry(
                    pollDocument,
                    {
                      maxRetries: 3,
                      baseDelay: 1000,
                      maxDelay: 4000
                    },
                    (attempt) => {
                      console.log(`Reintento ${attempt} para verificar estado de ${file.name}`);
                    }
                  );
                  
                  if (docData?.status === 'processed' && docData?.processed_text) {
                    setProcessedTexts(prev => ({...prev, [documentId]: docData.processed_text}));
                    setLoadingTexts(prev => ({...prev, [documentId]: false}));
                    setUploadProgress(100);
                    break;
                  }
                  
                  const progress = Math.min(90, 10 + Math.floor((attempts + 1) * (80 / maxAttempts)));
                  setUploadProgress(progress);
                  
                  attempts++;
                  await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                  console.error('Error verificando estado:', error);
                  break;
                }
              }
              
              if (attempts >= maxAttempts) {
                setLoadingTexts(prev => ({...prev, [documentId]: false}));
                setUploadProgress(0);
                toast({
                  title: "Error en el procesamiento",
                  description: "No se pudo completar el procesamiento del documento.",
                  variant: "destructive"
                });
              }
            };
            
            poll();
          }
        } catch (error) {
          console.error('Error procesando archivo:', error);
          setRetryAttempts(prev => ({...prev, [file.name]: 0}));
          toast({
            title: "Error",
            description: "No se pudo procesar el archivo después de varios intentos.",
            variant: "destructive"
          });
        }
      };

      reader.onerror = () => {
        console.error('Error leyendo archivo:', file.name);
        toast({
          title: "Error",
          description: "No se pudo leer el archivo.",
          variant: "destructive"
        });
      };

      reader.readAsDataURL(file);
    });

    setFiles(prev => [...prev, ...newFiles]);
    
    toast({
      title: "Archivos subidos exitosamente",
      description: `Se han agregado ${newFiles.length} archivo(s).`
    });
  }, [files, toast, setDocumentIds, setLoadingTexts, setProcessedTexts, setUploadProgress, setRetryAttempts]);

  const removeFile = (index: number) => {
    const fileToRemove = files[index];
    const documentId = documentIds[fileToRemove.name];
    
    console.log('Removiendo archivo:', fileToRemove.name, 'con documentId:', documentId);
    
    setFiles(files.filter((_, i) => i !== index));
    setDocumentIds(prev => {
      const newIds = { ...prev };
      delete newIds[fileToRemove.name];
      return newIds;
    });
    
    if (documentId) {
      setProcessedTexts(prev => {
        const newTexts = { ...prev };
        delete newTexts[documentId];
        return newTexts;
      });
      setLoadingTexts(prev => {
        const newLoadings = { ...prev };
        delete newLoadings[documentId];
        return newLoadings;
      });
    }
  };

  const isValidForAnalysis = files.length > 0 && requirements.title && requirements.skills.length > 0;

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const analysisResults = [];
      
      for (const file of files) {
        const documentId = documentIds[file.name];
        const cvText = processedTexts[documentId];
        
        if (!cvText) {
          console.log(`No text found for file: ${file.name}, documentId: ${documentId}`);
          continue;
        }

        try {
          const { data: analysis, error } = await supabase.functions.invoke('analyze-cv', {
            body: { cvText, requirements },
          });

          if (error) throw error;

          analysisResults.push({
            filename: file.name,
            match: analysis.match_percentage,
            skills: requirements.skills.map(skill => ({
              name: skill,
              found: analysis.skills_found.includes(skill)
            })),
            experience_summary: analysis.experience_summary,
            recommendation: analysis.recommendation
          });
        } catch (error) {
          console.error(`Error analyzing ${file.name}:`, error);
          toast({
            title: `Error al analizar ${file.name}`,
            description: "Hubo un problema al analizar este CV.",
            variant: "destructive"
          });
        }
      }

      setResults({
        analyzed: analysisResults.length,
        matches: analysisResults
      });

      toast({
        title: "Análisis completado",
        description: `Se han analizado ${analysisResults.length} CV(s) exitosamente.`
      });
    } catch (error) {
      console.error('Error en el análisis:', error);
      toast({
        title: "Error en el análisis",
        description: "Hubo un problema al analizar los CVs. Por favor, intenta nuevamente.",
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
            Checador de CV's
          </h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl font-normal">
            Sube CVs y compáralos con los requisitos del puesto usando nuestra IA
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <UploadZone onFilesAccepted={handleFilesAccepted} />
            
            <AnimatePresence>
              {files.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white rounded-lg shadow-sm border p-4"
                >
                  <h3 className="text-lg font-medium mb-4">Archivos Subidos</h3>
                  
                  {uploadProgress > 0 && (
                    <div className="mb-4">
                      <div className="flex justify-between text-sm text-gray-600 mb-2">
                        <span>Progreso de procesamiento</span>
                        <span>{Math.round(uploadProgress)}%</span>
                      </div>
                      <Progress 
                        value={uploadProgress} 
                        className="h-2"
                      />
                    </div>
                  )}
                  
                  <div className="space-y-4">
                    {files.map((file, index) => (
                      <div key={`${file.name}-${index}`} className="space-y-2">
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                          <div className="flex items-center space-x-3">
                            <FileText className="h-5 w-5 text-blue-500" />
                            <span className="text-sm text-gray-700">
                              {file.name}
                              {retryAttempts[file.name] > 0 && (
                                <span className="ml-2 text-xs text-yellow-600">
                                  (Reintento {retryAttempts[file.name]}/3)
                                </span>
                              )}
                            </span>
                          </div>
                          <button onClick={() => removeFile(index)} className="text-gray-400 hover:text-red-500 transition-colors">
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                        
                        {loadingTexts[documentIds[file.name]] && (
                          <div className="p-3 bg-gray-50 rounded-md flex items-center space-x-2 text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Procesando texto...</span>
                          </div>
                        )}
                        
                        {processedTexts[documentIds[file.name]] && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            <div className="p-3 bg-gray-50 rounded-md">
                              <div className="flex items-center space-x-2 mb-2 text-sm text-gray-700">
                                <FileSearch className="h-4 w-4" />
                                <span className="font-medium">Texto Extraído:</span>
                              </div>
                              <div className="text-sm text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                {processedTexts[documentIds[file.name]]}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div>
            <RequirementsForm requirements={requirements} setRequirements={setRequirements} />
          </div>
        </div>

        <div className="mt-8 text-center">
          <Button
            size="lg"
            onClick={handleAnalyze}
            disabled={!isValidForAnalysis || isAnalyzing}
            className="px-8"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analizando...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Analizar CVs
              </>
            )}
          </Button>
        </div>

        <AnimatePresence>
          {results && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-12 bg-white rounded-lg shadow-sm border p-6"
            >
              <h2 className="text-2xl font-semibold mb-6">Resultados del Análisis</h2>
              <div className="space-y-6">
                {results.matches.map((match: any, index: number) => (
                  <div
                    key={index}
                    className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium">{match.filename}</h3>
                      <span className={`text-lg font-semibold ${
                        match.match >= 75 ? 'text-green-600' :
                        match.match >= 50 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {match.match}% de coincidencia
                      </span>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Habilidades Requeridas:</h4>
                        <div className="flex flex-wrap gap-2">
                          {match.skills.map((skill: any, skillIndex: number) => (
                            <span
                              key={skillIndex}
                              className={`px-3 py-1 rounded-full text-sm ${
                                skill.found
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {skill.name}
                              {skill.found ? 
                                <Check className="inline-block ml-1 h-4 w-4" /> : 
                                <X className="inline-block ml-1 h-4 w-4" />
                              }
                            </span>
                          ))}
                        </div>
                      </div>
                      {match.experience_summary && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Resumen de Experiencia:</h4>
                          <p className="text-sm text-gray-600">{match.experience_summary}</p>
                        </div>
                      )}
                      {match.recommendation && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Recomendación:</h4>
                          <p className="text-sm text-gray-600">{match.recommendation}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Index;
