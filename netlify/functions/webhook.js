// netlify/functions/webhook.js
// CardsQuest — Stripe webhook handler
// Upgrades user plan in localStorage via redirect after successful payment

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // If webhook secret configured, verify signature
  if (webhookSecret) {
    try {
      const stripeEvent = stripe.webhooks.constructEvent(
        event.body, sig, webhookSecret
      );

      // Handle successful payment
      if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object;
        const plan = session.metadata?.plan;
        const email = session.metadata?.email;
        console.log(`Plan upgraded: ${email} → ${plan}`);
        // In a full backend you'd update a database here
        // For localStorage-based auth, the redirect URL handles the upgrade
      }

      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    } catch (err) {
      console.error('Webhook signature error:', err.message);
      return { statusCode: 400, body: `Webhook error: ${err.message}` };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
