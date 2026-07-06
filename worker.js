// ============================================================
// Shadow ES — Cloudflare Worker (o "cérebro")
// Modos (campo "mode" no corpo do POST):
//   - "correct" (padrão): corrige a frase falada (Gemini)
//   - "explain": explica + dá exemplos de uma frase (Gemini)
//   - "azToken": emite um token temporário da Azure (pronúncia)
// Segredos necessários (Settings > Variables and Secrets):
//   GEMINI_KEY   (obrigatório)
//   AZURE_KEY, AZURE_REGION  (só para a nota de pronúncia / v2)
// ============================================================

const MODEL = 'gemini-2.5-flash';   // mais barato ainda: 'gemini-2.5-flash-lite'

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST')    return json({ error: 'use POST' }, 405, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'json inválido' }, 400, cors); }

    const mode = body.mode || 'correct';
    try {
      if (mode === 'correct') return await doCorrect(body, env, cors);
      if (mode === 'explain') return await doExplain(body, env, cors);
      if (mode === 'azToken') return await doAzToken(env, cors);
      return json({ error: 'modo desconhecido: ' + mode }, 400, cors);
    } catch (e) {
      return json({ error: 'falha no worker', detail: String(e) }, 500, cors);
    }
  },
};

// -------- MODO 1: corrigir --------
async function doCorrect(body, env, cors) {
  const text = String(body.text || '').slice(0, 300).trim();
  if (!text) return json({ error: 'texto vazio' }, 400, cors);

  const payload = {
    systemInstruction: { parts: [{ text:
      'Eres un profesor de español de España (peninsular). Un estudiante brasileño intenta decir una frase en español. ' +
      'Recibes una transcripción automática que PUEDE tener errores de reconocimiento de voz. ' +
      'Devuelve la versión más natural y correcta en español de España de lo que probablemente quiso decir. ' +
      'Si ya era correcta, mantenla. La nota (note_pt) y la traducción (translation_pt) van en portugués de Brasil, y note_pt debe ser muy breve.'
    }] },
    contents: [{ parts: [{ text: `Transcripción del alumno: "${text}"` }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          corrected:      { type: 'STRING'  },
          wasCorrect:     { type: 'BOOLEAN' },
          note_pt:        { type: 'STRING'  },
          translation_pt: { type: 'STRING'  },
        },
        required: ['corrected', 'wasCorrect', 'note_pt', 'translation_pt'],
      },
    },
  };
  return await callGemini(payload, env, cors, { corrected: text, wasCorrect: false, note_pt: '', translation_pt: '' });
}

// -------- MODO 2: explicar + exemplos --------
async function doExplain(body, env, cors) {
  const phrase = String(body.phrase || '').slice(0, 300).trim();
  if (!phrase) return json({ error: 'frase vazia' }, 400, cors);

  const payload = {
    systemInstruction: { parts: [{ text:
      'Eres un profesor de español de España. Explica de forma MUY BREVE y clara, en portugués de Brasil, el punto clave ' +
      '(gramática, expresión o pronunciación) de la frase dada. Luego crea 2 frases de ejemplo naturales en español de España ' +
      'que usen la misma estructura o expresión, cada una con su traducción al portugués.'
    }] },
    contents: [{ parts: [{ text: `Frase: "${phrase}"` }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          explanation_pt: { type: 'STRING' },
          examples: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { es: { type: 'STRING' }, pt: { type: 'STRING' } }, required: ['es', 'pt'] },
          },
        },
        required: ['explanation_pt', 'examples'],
      },
    },
  };
  return await callGemini(payload, env, cors, { explanation_pt: '', examples: [] });
}

// -------- MODO 3: token da Azure (pronúncia) --------
async function doAzToken(env, cors) {
  if (!env.AZURE_KEY || !env.AZURE_REGION)
    return json({ error: 'Azure não configurada (faltam AZURE_KEY/AZURE_REGION)' }, 400, cors);
  const url = `https://${env.AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  const r = await fetch(url, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_KEY } });
  if (!r.ok) return json({ error: 'Azure recusou', status: r.status, detail: await r.text() }, 502, cors);
  return json({ token: await r.text(), region: env.AZURE_REGION }, 200, cors);
}

// -------- util Gemini --------
async function callGemini(payload, env, cors, fallback) {
  if (!env.GEMINI_KEY) return json({ error: 'GEMINI_KEY não configurada' }, 400, cors);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_KEY}`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) return json({ error: 'Gemini retornou erro', status: r.status, detail: await r.text() }, 502, cors);
  const data = await r.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  let parsed;
  try { parsed = JSON.parse(out); } catch { parsed = fallback; }
  return json(parsed, 200, cors);
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
