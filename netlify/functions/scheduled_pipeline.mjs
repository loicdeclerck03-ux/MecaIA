// ============================================================
// SCHEDULED_PIPELINE.MJS — Cron Job (Netlify Functions)
// Tourne: Lundi 3h du matin + Jeudi 3h du matin (UTC)
// Appelle orchestrator pour scraper/cleaner/consolidator
// ============================================================

const ORCHESTRATOR_URL = process.env.FRONTEND_URL || 'http://localhost:8888';

export default async (req, context) => {
  // Détecter une invocation planifiée (Netlify envoie { next_run } dans le body).
  let scheduled = false;
  try {
    const body = await req.json();
    scheduled = !!(body && body.next_run);
  } catch { /* pas de body JSON */ }

  // Si ce n'est PAS le cron, exiger un secret (déclenchement manuel protégé).
  if (!scheduled) {
    const provided = req.headers.get('x-cron-secret') || req.headers.get('x-netlify-token');
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  }

  console.log('\n========================================');
  console.log('🕐 SCHEDULED PIPELINE EXECUTION');
  console.log('========================================\n');

  const startTime = Date.now();
  const topics = [
    'peugeot_diesel_fap',
    'renault_clio_egr',
    'bmw_injectors',
    'mercedes_dpf',
    'volkswagen_turbo'
  ];

  const results = [];
  let success_count = 0;
  let failure_count = 0;

  for (const topic of topics) {
    try {
      console.log(`[${new Date().toISOString()}] Processing: ${topic}`);

      // Appeler l'orchestrator
      const response = await fetch(`${ORCHESTRATOR_URL}/.netlify/functions/orchestrator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ topic })
      });

      const data = await response.json();

      if (data.success) {
        console.log(`  ✅ ${topic} completed`);
        results.push({
          topic,
          status: 'success',
          diagnosis: data.metadata?.consolidated_case?.most_likely_cause,
          confidence: data.metadata?.consolidated_case?.confidence_consolidated
        });
        success_count++;
      } else {
        console.log(`  ❌ ${topic} failed: ${data.error}`);
        results.push({
          topic,
          status: 'failed',
          error: data.error
        });
        failure_count++;
      }
    } catch (error) {
      console.error(`  ❌ ${topic} error:`, error.message);
      results.push({
        topic,
        status: 'error',
        error: error.message
      });
      failure_count++;
    }

    // Attendre 1s entre chaque requête (éviter rate limiting)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const elapsedMs = Date.now() - startTime;

  console.log('\n========================================');
  console.log('📊 SCHEDULED PIPELINE SUMMARY');
  console.log('========================================\n');

  console.log(`Total topics processed: ${topics.length}`);
  console.log(`✅ Successes: ${success_count}`);
  console.log(`❌ Failures: ${failure_count}`);
  console.log(`⏱️  Total time: ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log('');

  return new Response(
    JSON.stringify({
      success: failure_count === 0,
      execution_time: elapsedMs,
      schedule: 'Monday & Thursday 3:00 AM UTC',
      topics_processed: topics.length,
      successes: success_count,
      failures: failure_count,
      results: results,
      next_execution: getNextExecution()
    }),
    {
      status: failure_count === 0 ? 200 : 207,
      headers: { 'Content-Type': 'application/json' }
    }
  );
};

// ============================================================
// HELPER: Calculate next scheduled execution
// ============================================================
function getNextExecution() {
  const now = new Date();
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Find next Monday or Thursday
  let daysUntilNext = 0;
  const currentDay = now.getDay();

  if (currentDay < 1) {
    daysUntilNext = 1 - currentDay; // Lundi
  } else if (currentDay < 4) {
    daysUntilNext = 4 - currentDay; // Jeudi
  } else if (currentDay === 4) {
    daysUntilNext = 4; // Jeudi again après weekend
  } else {
    daysUntilNext = 8 - currentDay + 1; // Lundi de la semaine suivante
  }

  const nextExecution = new Date(now);
  nextExecution.setDate(nextExecution.getDate() + daysUntilNext);
  nextExecution.setHours(3, 0, 0, 0);

  return nextExecution.toISOString();
}
