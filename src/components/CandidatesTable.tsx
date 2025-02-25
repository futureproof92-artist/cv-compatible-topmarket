import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Edit, Check, X, Trash2 } from 'lucide-react';
import { Candidate } from '@/types';
import { useToast } from "@/components/ui/use-toast"
import { supabase } from '@/integrations/supabase/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Calendar } from "@/components/ui/calendar"
import { CalendarIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { DateRange } from "react-day-picker"
import { useDebounce } from '@/hooks/useDebounce';

interface CandidatesTableProps {
  initialCandidates: Candidate[];
  setLastAction: React.Dispatch<{ type: string; data: Candidate[] | Candidate }>;
}

const CandidatesTable: React.FC<CandidatesTableProps> = ({ initialCandidates, setLastAction }) => {
  const [candidates, setCandidates] = useState<Candidate[]>(initialCandidates);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newCandidate, setNewCandidate] = useState<Omit<Candidate, 'id'>>({
    name: '',
    email: '',
    phone: '',
    linkedin: '',
    status: 'Applied',
    score: 0,
    notes: '',
    time: new Date(),
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const [date, setDate] = React.useState<DateRange | undefined>(undefined)

  const { data: candidatesData, isLoading, isError, refetch } = useQuery({
    queryKey: ['candidates', debouncedSearch, date],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('*')
        .order('time', { ascending: false });

      if (debouncedSearch) {
        query = query.ilike('name', `%${debouncedSearch}%`);
      }

      if (date?.from && date?.to) {
        query = query.gte('time', format(date.from, 'yyyy-MM-dd'))
          .lte('time', format(date.to, 'yyyy-MM-dd'));
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching candidates:", error);
        throw error;
      }
      return data as Candidate[];
    },
    initialData: initialCandidates,
  });

  useEffect(() => {
    if (candidatesData) {
      setCandidates(candidatesData);
    }
  }, [candidatesData]);

  const normalizeTime = (time: Date | string): string => {
    if (typeof time === 'string') {
      return time;
    }
    return time.toISOString();
  };

  const updateCandidateMutation = useMutation({
    mutationFn: async (updatedCandidate: Candidate) => {
      console.log('Ejecutando mutación de actualización:', updatedCandidate);

      // Store the original state for undo capability
      const originalCandidate = initialCandidates.find(c => c.id === updatedCandidate.id);
      const previousState = originalCandidate ? { ...originalCandidate } : updatedCandidate;

      // Normalize the time before updating
      const normalizedCandidate = {
        ...updatedCandidate,
        time: normalizeTime(updatedCandidate.time),
      };

      console.log('Candidato normalizado para actualización:', normalizedCandidate);

      try {
        const { data, error } = await supabase
          .from('candidates')
          .update(normalizedCandidate)
          .eq('id', updatedCandidate.id)
          .select();

        if (error) {
          console.error('Error en actualización:', error);
          throw error;
        }

        setLastAction({
          type: 'single',
          data: previousState
        });

        return data ? data[0] as Candidate : null;
      } catch (error) {
        console.error('Error en la mutación de actualización:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  const deleteCandidateMutation = useMutation({
    mutationFn: async (id: string) => {
      console.log('Ejecutando mutación de eliminación:', id);

      // Store the original state for undo capability
      const originalCandidate = initialCandidates.find(c => c.id === id);
      const previousState = originalCandidate ? { ...originalCandidate } : null;

      try {
        const { data, error } = await supabase
          .from('candidates')
          .delete()
          .eq('id', id)
          .select();

        if (error) {
          console.error('Error en eliminación:', error);
          throw error;
        }

        setLastAction({
          type: 'single',
          data: previousState
        });

        return data ? data[0] as Candidate : null;
      } catch (error) {
        console.error('Error en la mutación de eliminación:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  const createCandidateMutation = useMutation({
    mutationFn: async (newCandidate: Omit<Candidate, 'id'>) => {
      console.log('Ejecutando mutación de creación:', newCandidate);

      // Normalize the time before inserting
      const normalizedCandidate = {
        ...newCandidate,
        time: normalizeTime(newCandidate.time),
      };

      console.log('Candidato normalizado para creación:', normalizedCandidate);

      try {
        const { data, error } = await supabase
          .from('candidates')
          .insert([normalizedCandidate])
          .select();

        if (error) {
          console.error('Error en creación:', error);
          throw error;
        }

        setNewCandidate({
          name: '',
          email: '',
          phone: '',
          linkedin: '',
          status: 'Applied',
          score: 0,
          notes: '',
          time: new Date(),
        });

        return data ? data[0] as Candidate : null;
      } catch (error) {
        console.error('Error en la mutación de creación:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (candidates: Candidate[]) => {
      console.log('Ejecutando mutación de actualización masiva:', candidates);

      // Store the original state for undo capability
      const previousState = candidates.map(c => {
        const original = initialCandidates.find(ic => ic.id === c.id);
        return original ? { ...original } : c;
      });

      // Normalize the candidates before updating
      const normalizedCandidates = candidates.map(candidate => ({
        ...candidate,
        time: normalizeTime(candidate.time)
      })); // Cerrado correctamente el objeto y la función map

      console.log('Candidatos normalizados para actualización:', normalizedCandidates);

      try {
        // Use a single upsert operation for better performance
        const { data, error } = await supabase
          .from('candidates')
          .upsert(normalizedCandidates)
          .select();
        
        if (error) {
          console.error('Error en actualización masiva:', error);
          throw error;
        }
        
        setLastAction({
          type: 'bulk',
          data: previousState
        });
        
        return data || [];
      } catch (error) {
        console.error('Error en la mutación de actualización masiva:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  const handleInputChange = (id: string, field: keyof Candidate, value: any) => {
    setCandidates(prev =>
      prev.map(c =>
        c.id === id ? { ...c, [field]: value } : c
      )
    );
  };

  const handleNewCandidateInputChange = (field: keyof Omit<Candidate, 'id'>, value: any) => {
    setNewCandidate(prev => ({ ...prev, [field]: value }));
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
  };

  const handleCancel = () => {
    setCandidates(initialCandidates);
    setEditingId(null);
  };

  const handleSave = async (id: string) => {
    const candidateToUpdate = candidates.find(c => c.id === id);
    if (candidateToUpdate) {
      try {
        await updateCandidateMutation.mutateAsync(candidateToUpdate);
        toast({
          title: "Candidato actualizado exitosamente",
        });
        setEditingId(null);
      } catch (error: any) {
        toast({
          variant: "destructive",
          title: "Error al actualizar el candidato",
          description: error.message,
        })
      }
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCandidateMutation.mutateAsync(id);
      toast({
        title: "Candidato eliminado exitosamente",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error al eliminar el candidato",
        description: error.message,
      })
    }
  };

  const handleCreate = async () => {
    try {
      await createCandidateMutation.mutateAsync(newCandidate);
      toast({
        title: "Candidato creado exitosamente",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error al crear el candidato",
        description: error.message,
      })
    }
  };

  const handleBulkUpdate = async () => {
    try {
      await bulkUpdateMutation.mutateAsync(candidates);
      toast({
        title: "Candidatos actualizados exitosamente",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error al actualizar los candidatos",
        description: error.message,
      })
    }
  };

  if (isLoading) return <Progress value={75} />;
  if (isError) return <p>Error fetching candidates</p>;

  return (
    <div>
      <div className="flex items-center py-4">
        <Input
          type="search"
          placeholder="Buscar candidato..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm mr-2"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={"outline"}
              className={cn(
                "justify-start text-left font-normal",
                !date && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {date?.from ? (
                date.to ? (
                  <>
                    {format(date.from, "LLL dd, y")} -{" "}
                    {format(date.to, "LLL dd, y")}
                  </>
                ) : (
                  format(date.from, "LLL dd, y")
                )
              ) : (
                <span>Pick a date</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="center" side="bottom">
            <Calendar
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={setDate}
              disabled={(date) =>
                date > new Date() || date < new Date("2020-01-01")
              }
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Teléfono</TableHead>
            <TableHead>LinkedIn</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Puntaje</TableHead>
            <TableHead>Notas</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map(candidate => (
            <TableRow key={candidate.id}>
              <TableCell>
                {editingId === candidate.id ? (
                  <Input
                    type="text"
                    value={candidate.name}
                    onChange={(e) => handleInputChange(candidate.id, 'name', e.target.value)}
                  />
                ) : (
                  candidate.name
                )}
              </TableCell>
              <TableCell>
                {editingId === candidate.id ? (
                  <Input
                    type="email"
                    value={candidate.email}
                    onChange={(e) => handleInputChange(candidate.id, 'email', e.target.value)}
                  />
                ) : (
                  candidate.email
                )}
              </TableCell>
              <TableCell>
                {editingId === candidate.id ? (
                  <Input
                    type="tel"
                    value={candidate.phone}
                    onChange={(e) => handleInputChange(candidate.id, 'phone', e.target.value)}
                  />
                ) : (
                  candidate.phone
                )}
              </TableCell>
              <TableCell>
                {editingId === candidate.id ? (
                  <Input
                    type="url"
                    value={candidate.linkedin}
                    onChange={(e) => handleInputChange(candidate.id, 'linkedin', e.target.value)}
                  />
                ) : (
                  candidate.linkedin
                )}
              </TableCell>
              <TableCell>
                {editingId === candidate.id ? (
                  <Select
                    value={candidate.status}
                    onValueChange={(value) => handleInputChange(candidate.id, 'status', value)}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder={candidate.status} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Applied">Applied</SelectItem>
                      <SelectItem value="Interviewing">Interviewing</SelectItem>
                      <SelectItem value="Offer">Offer</SelectItem>
                      <SelectItem value="Hired">Hired</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  candidate.status
                )}
              </TableCell>
              <TableCell>
                {editingId === candidate.id ? (
                  <Slider
                    defaultValue={[candidate.score]}
                    max={100}
                    step={1}
                    onValueChange={(value) => handleInputChange(candidate.id, 'score', value[0])}
                  />
                ) : (
                  <Badge variant="secondary">{candidate.score}</Badge>
                )}
              </TableCell>
              <TableCell>
                {editingId === candidate.id ? (
                  <Textarea
                    value={candidate.notes}
                    onChange={(e) => handleInputChange(candidate.id, 'notes', e.target.value)}
                  />
                ) : (
                  candidate.notes
                )}
              </TableCell>
              <TableCell>
                {editingId === candidate.id ? (
                  <Input
                    type="datetime-local"
                    value={typeof candidate.time === 'string' ? candidate.time : candidate.time.toISOString().slice(0, 16)}
                    onChange={(e) => handleInputChange(candidate.id, 'time', e.target.value)}
                  />
                ) : (
                  new Date(candidate.time).toLocaleDateString()
                )}
              </TableCell>
              <TableCell className="text-right">
                {editingId === candidate.id ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSave(candidate.id)}
                      disabled={updateCandidateMutation.isPending}
                    >
                      <Check className="h-4 w-4 mr-2" /> Guardar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancel()}
                      disabled={updateCandidateMutation.isPending}
                    >
                      <X className="h-4 w-4 mr-2" /> Cancelar
                    </Button>
                  </div>
                ) : (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(candidate.id)}
                    >
                      <Edit className="h-4 w-4 mr-2" /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(candidate.id)}
                      disabled={deleteCandidateMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Borrar
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Agregar Candidato</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Agregar Candidato</DialogTitle>
            <DialogDescription>
              Agrega un nuevo candidato a la lista.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Nombre
              </Label>
              <Input
                type="text"
                id="name"
                value={newCandidate.name}
                onChange={(e) => handleNewCandidateInputChange('name', e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">
                Email
              </Label>
              <Input
                type="email"
                id="email"
                value={newCandidate.email}
                onChange={(e) => handleNewCandidateInputChange('email', e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="phone" className="text-right">
                Teléfono
              </Label>
              <Input
                type="tel"
                id="phone"
                value={newCandidate.phone}
                onChange={(e) => handleNewCandidateInputChange('phone', e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="linkedin" className="text-right">
                LinkedIn
              </Label>
              <Input
                type="url"
                id="linkedin"
                value={newCandidate.linkedin}
                onChange={(e) => handleNewCandidateInputChange('linkedin', e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="status" className="text-right">
                Estado
              </Label>
              <Select onValueChange={(value) => handleNewCandidateInputChange('status', value)}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Selecciona un estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Applied">Applied</SelectItem>
                  <SelectItem value="Interviewing">Interviewing</SelectItem>
                  <SelectItem value="Offer">Offer</SelectItem>
                  <SelectItem value="Hired">Hired</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="score" className="text-right">
                Puntaje
              </Label>
              <Slider
                defaultValue={[newCandidate.score]}
                max={100}
                step={1}
                onValueChange={(value) => handleNewCandidateInputChange('score', value[0])}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="notes" className="text-right">
                Notas
              </Label>
              <Textarea
                id="notes"
                value={newCandidate.notes}
                onChange={(e) => handleNewCandidateInputChange('notes', e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="time" className="text-right">
                Fecha
              </Label>
              <Input
                type="datetime-local"
                id="time"
                value={newCandidate.time.toISOString().slice(0, 16)}
                onChange={(e) => handleNewCandidateInputChange('time', new Date(e.target.value))}
                className="col-span-3"
              />
            </div>
          </div>
          <Button type="submit" onClick={handleCreate}>Agregar</Button>
        </DialogContent>
      </Dialog>

      <Button variant="outline" onClick={handleBulkUpdate} disabled={bulkUpdateMutation.isPending}>
        Actualizar Cambios
      </Button>
    </div>
  );
};

export default CandidatesTable;
