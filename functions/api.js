export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  try {
    const { type, messages, system, max_tokens } = await context.request.json();
    if (type === 'claude') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': context.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: max_tokens || 1500,
          system: system,
          messages: messages
        })
      });
      const data = await response.json();
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }
    return new Response(JSON.stringify({ error: 'Unknown type' }), { status: 400, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
}
