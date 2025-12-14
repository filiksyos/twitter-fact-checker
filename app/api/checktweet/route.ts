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

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    
    if (!text || text.length < 50) {
      return NextResponse.json({ error: 'Tweet text is required and must be at least 50 characters' }, { status: 400 });
    }

    console.log('[CheckTweet] Processing tweet:', text.substring(0, 100) + '...');

    // Step 1: Use Exa's fast /answer endpoint to find inaccuracies
    const exaQuery = `Find phrases or words that are factually incorrect, misleading, or hallucinated in this text: "${text}"`;
    
    let exaAnswer = '';
    try {
      const stream = await exa.streamAnswer(exaQuery);
      
      // Collect the streamed response
      for await (const chunk of stream) {
        exaAnswer += chunk;
      }
      
      console.log('[CheckTweet] Exa analysis:', exaAnswer.substring(0, 200));
    } catch (exaError) {
      console.error('[CheckTweet] Exa API error:', exaError);
      // If Exa fails, try to continue with OpenAI only
      exaAnswer = 'Unable to verify with external sources.';
    }

    // Step 2: Use OpenRouter to analyze and mark up the text
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
    console.log('[CheckTweet] OpenAI result:', result);

    return NextResponse.json({
      hasIssues: result.hasIssues || false,
      incorrect: result.incorrect || [],
      corrections: result.corrections || [],
      summary: result.summary || 'Analysis complete',
      exaAnalysis: exaAnswer
    });

  } catch (error: any) {
    console.error('[CheckTweet] Error:', error);
    return NextResponse.json({ 
      error: `Failed to check tweet: ${error.message}` 
    }, { status: 500 });
  }
}