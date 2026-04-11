// netlify/functions/webhook.js
// CardsQuest — Stripe webhook — upgrades plan in Supabase on payment

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const stripeEvent = JSON.parse(event.body);
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const plan = session.metadata?.plan;
      const email = session.metadata?.email;

      if (plan && email && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ plan }),
        });
        console.log(`Plan upgraded: ${email} → ${plan}`);
      }
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }
};
