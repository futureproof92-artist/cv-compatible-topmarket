
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { Base64 } from 'https://deno.land/x/bb64@1.1.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file')

    if (!file) {
      throw new Error('No file uploaded')
    }

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get file details
    const fileName = file.name
    const contentType = file.type
    const fileExtension = fileName.split('.').pop()?.toLowerCase()

    // Generate a unique file path
    const filePath = `${crypto.randomUUID()}.${fileExtension}`

    // Upload file to Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file, {
        contentType: contentType,
        upsert: false
      })

    if (uploadError) {
      throw new Error(`Failed to upload file: ${uploadError.message}`)
    }

    // Insert document record
    const { data: documentData, error: insertError } = await supabase
      .from('documents')
      .insert({
        filename: fileName,
        file_path: filePath,
        content_type: contentType,
        status: 'uploaded'
      })
      .select()
      .single()

    if (insertError) {
      throw new Error(`Failed to create document record: ${insertError.message}`)
    }

    // Get the uploaded file URL
    const { data: { publicUrl } } = supabase.storage
      .from('documents')
      .getPublicUrl(filePath)

    console.log('Document processed successfully:', {
      id: documentData.id,
      filename: fileName,
      contentType: contentType,
      status: 'uploaded'
    })

    return new Response(
      JSON.stringify({
        message: 'File uploaded and processed successfully',
        document: documentData,
        url: publicUrl
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error('Error processing document:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process document', 
        details: error.message 
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        },
        status: 500 
      }
    )
  }
})
