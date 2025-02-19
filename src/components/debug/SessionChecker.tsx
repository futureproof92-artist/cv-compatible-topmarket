
import { useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

const SessionChecker = () => {
  useEffect(() => {
    async function fetchSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        console.log("Respuesta getSession():", data, error);

        if (error) {
          console.error("Error al obtener la sesión:", error);
          return;
        }

        if (!data?.session?.access_token) {
          console.error("No se encontró token de acceso. ¿Estás logueado?");
          return;
        }

        // Si todo está bien, mostramos el token
        console.log("Token de acceso:", data.session.access_token);
      } catch (err) {
        console.error("Error inesperado:", err);
      }
    }

    fetchSession();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Verificador de Sesión
          <Badge variant="secondary">Debug</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-600">
          Abre la consola del navegador (F12) para ver la información detallada de la sesión.
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Este componente es solo para depuración y desarrollo.
        </p>
      </CardContent>
    </Card>
  );
};

export default SessionChecker;
