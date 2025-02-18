
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { ImageAnnotatorClient } from 'https://esm.sh/@google-cloud/vision@4.0.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { documentId, imageUrl } = await req.json()

    if (!documentId || !imageUrl) {
      throw new Error('Document ID and image URL are required')
    }

    // Initialize Google Cloud Vision client
    const credentials = JSON.parse(Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS') || '{}')
    const visionClient = new ImageAnnotatorClient({ credentials })

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('Processing image:', documentId)

    // Get the image data from Supabase Storage
    const { data: imageData, error: downloadError } = await supabase
      .storage
      .from('documents')
      .download(imageUrl)

    if (downloadError) {
      throw new Error(`Failed to download image: ${downloadError.message}`)
    }

    // Convert image to base64
    const buffer = await imageData.arrayBuffer()
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(buffer)))

    // Perform OCR using Google Cloud Vision
    const [result] = await visionClient.textDetection({
      image: {
        content: base64Image
      }
    })

    const detections = result.textAnnotations
    const extractedText = detections?.[0]?.description || ''

    console.log('Text extracted successfully')

    // Update document with extracted text
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        processed_text: extractedText,
        processed_at: new Date().toISOString(),
        status: 'processed'
      })
      .eq('id', documentId)

    if (updateError) {
      throw new Error(`Failed to update document: ${updateError.message}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        text: extractedText,
        documentId
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error('Error processing image:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process image', 
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
