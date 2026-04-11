// netlify/functions/webhook.js
// CardsQuest — Stripe webhook (no npm needed)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const stripeEvent = JSON.parse(event.body);
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      console.log(`Payment completed: ${session.metadata?.email} → ${session.metadata?.plan}`);
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }
};
