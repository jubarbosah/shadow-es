// ============================================================
// Shadow ES — Cloudflare Worker (o "cérebro")
// Recebe a transcrição do que você falou e devolve a versão
// correta em espanhol da Espanha, usando o Gemini.
// A sua chave do Gemini fica AQUI (secreta), nunca no celular.
//
// Deploy:
//   1) Cloudflare → Workers & Pages → Create → Worker
//   2) Cole este código
//   3) Settings → Variables and Secrets → adicione o segredo:
//        Nome:  GEMINI_KEY     Valor: (sua chave do Gemini)
//   4) Deploy. Copie a URL (algo .workers.dev) e cole no index.html
// ============================================================

const MODEL = 'gemini-2.5-flash';        // barato e bom. Ainda mais barato: 'gemini-2.5-flash-lite'

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',          // v2: troque '*' pela URL do seu app
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST')    return json({ error: 'use POST' }, 405, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'json inválido' }, 400, cors); }
    const text = String(body.text || '').slice(0, 300).trim();
    if (!text) return json({ error: 'texto vazio' }, 400, cors);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_KEY}`;

    const payload = {
      systemInstruction: { parts: [{ text:
        'Eres un profesor de español de España (peninsular). Un estudiante brasileño intenta decir una frase en español. ' +
        'Recibes una transcripción automática que PUEDE tener errores de reconocimiento de voz. ' +
        'Devuelve la versión más natural y correcta en español de España de lo que probablemente quiso decir. ' +
        'Si ya era correcta, mantenla. La nota (note_pt) y la traducción (translation_pt) van en portugués de Brasil, y note_pt debe ser muy breve (qué se corrigió o por qué está bien).'
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

    let r;
    try {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) { return json({ error: 'falha ao chamar Gemini', detail: String(e) }, 502, cors); }

    if (!r.ok) return json({ error: 'Gemini retornou erro', status: r.status, detail: await r.text() }, 502, cors);

    const data = await r.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed;
    try { parsed = JSON.parse(out); }
    catch { parsed = { corrected: text, wasCorrect: false, note_pt: '', translation_pt: '' }; }

    return json(parsed, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
