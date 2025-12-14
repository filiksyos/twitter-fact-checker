// app/api/checktweet/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Exa from 'exa-js';
import OpenAI from 'openai';

export const maxDuration = 60;

const exa = new Exa(process.env.EXA_API_KEY as string);
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// Handle CORS preflight requests
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function POST(req: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  const timestamp = new Date().toISOString();
  
  try {
    console.log(`\n[${timestamp}] [Request ${requestId}] ==========================================`);
    console.log(`[${timestamp}] [Request ${requestId}] 📥 Incoming API request to /api/checktweet`);
    console.log(`[${timestamp}] [Request ${requestId}] IP: ${req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'}`);
    console.log(`[${timestamp}] [Request ${requestId}] User-Agent: ${req.headers.get('user-agent') || 'unknown'}`);
    
    const { text } = await req.json();
    
    if (!text || text.length < 50) {
      console.log(`[${timestamp}] [Request ${requestId}] ❌ Validation failed: Tweet text too short or missing`);
      return NextResponse.json({ error: 'Tweet text is required and must be at least 50 characters' }, { 
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    console.log(`[${timestamp}] [Request ${requestId}] ✅ Validation passed`);
    console.log(`[${timestamp}] [Request ${requestId}] 📝 Tweet text (first 100 chars): ${text.substring(0, 100)}...`);
    console.log(`[${timestamp}] [Request ${requestId}] 📏 Tweet length: ${text.length} characters`);

    // Step 1: Use Exa's fast /answer endpoint to find inaccuracies
    const exaQuery = `Find phrases or words that are factually incorrect, misleading, or hallucinated in this text: "${text}"`;
    
    let exaAnswer = '';
    try {
      console.log(`[${timestamp}] [Request ${requestId}] 🔍 Calling Exa API...`);
      const stream = await exa.streamAnswer(exaQuery);
      
      // Collect the streamed response
      for await (const chunk of stream) {
        exaAnswer += chunk;
      }
      
      console.log(`[${timestamp}] [Request ${requestId}] ✅ Exa API response received`);
      console.log(`[${timestamp}] [Request ${requestId}] 📊 Exa analysis (first 200 chars): ${exaAnswer.substring(0, 200)}...`);
    } catch (exaError) {
      console.error(`[${timestamp}] [Request ${requestId}] ❌ Exa API error:`, exaError);
      // If Exa fails, try to continue with OpenAI only
      exaAnswer = 'Unable to verify with external sources.';
    }

    // Step 2: Use OpenRouter to analyze and mark up the text
    console.log(`[${timestamp}] [Request ${requestId}] 🤖 Calling OpenAI/OpenRouter API...`);
    const completion = await openai.chat.completions.create({
      model: 'openai/gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a fact-checking assistant. Based on the fact-check analysis provided, identify:
1. Exact phrases or words that are incorrect (these will be marked in RED)
2. The correct information to replace them with (these will be shown in GREEN)

Return a JSON object with this structure:
{
  "hasIssues": boolean,
  "incorrect": ["exact phrase 1", "exact phrase 2"],
  "corrections": ["correction 1", "correction 2"],
  "summary": "Brief explanation of what's wrong"
}

If no issues are found, return: {"hasIssues": false, "summary": "No factual issues detected"}

Be precise - only mark text that is definitively incorrect based on the analysis.`
        },
        {
          role: 'user',
          content: `Original tweet: "${text}"

Fact-check analysis from Exa:
${exaAnswer}

Based on this analysis, identify incorrect phrases and provide corrections.`
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');
    console.log(`[${timestamp}] [Request ${requestId}] ✅ OpenAI/OpenRouter response received`);
    console.log(`[${timestamp}] [Request ${requestId}] 📊 Analysis result:`, {
      hasIssues: result.hasIssues || false,
      incorrectCount: result.incorrect?.length || 0,
      correctionsCount: result.corrections?.length || 0,
      summary: result.summary || 'Analysis complete'
    });

    const response = {
      hasIssues: result.hasIssues || false,
      incorrect: result.incorrect || [],
      corrections: result.corrections || [],
      summary: result.summary || 'Analysis complete',
      exaAnalysis: exaAnswer
    };

    console.log(`[${timestamp}] [Request ${requestId}] ✅ Sending response to client`);
    console.log(`[${timestamp}] [Request ${requestId}] ==========================================\n`);

    return NextResponse.json(response, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error: any) {
    console.error(`[${timestamp}] [Request ${requestId}] ❌ Error occurred:`, error);
    console.error(`[${timestamp}] [Request ${requestId}] Error message: ${error.message}`);
    console.error(`[${timestamp}] [Request ${requestId}] Error stack:`, error.stack);
    console.log(`[${timestamp}] [Request ${requestId}] ==========================================\n`);
    return NextResponse.json({ 
      error: `Failed to check tweet: ${error.message}` 
    }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
}