import { db } from "@/lib/db";
import { userSubscriptions } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req: Request) {
    const body = await req.text();
    const signature = headers().get("Stripe-Signature") as string;
    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(
            body,
            signature,
            process.env.STRIPE_WEBHOOK_SIGNING_SECRET as string
        );
    } catch (error) {
        console.error("Error validating Stripe signature", error);
        return new NextResponse("Webhook error", { status: 400 });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    try {
        // New subscription created
        if (event.type === "checkout.session.completed") {
            const subscription = await stripe.subscriptions.retrieve(
                session.subscription as string
            );

            if (!session?.metadata?.userId) {
                console.error("User ID not found in session metadata");
                return new NextResponse("No userId", { status: 400 });
            }

            await db.insert(userSubscriptions).values({
                userId: session.metadata.userId,
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: subscription.customer as string,
                stripePriceId: subscription.items.data[0].price.id,
                stripeCurrentPeriodEnd: new Date(
                    subscription.current_period_end * 1000
                ),
            });

            console.log("Subscription added to the database successfully");
        }

        // Payment succeeded
        if (event.type === "invoice.payment_succeeded") {
            const subscription = await stripe.subscriptions.retrieve(
                session.subscription as string
            );

            await db
                .update(userSubscriptions)
                .set({
                    stripePriceId: subscription.items.data[0].price.id,
                    stripeCurrentPeriodEnd: new Date(
                        subscription.current_period_end * 1000
                    ),
                })
                .where(
                    eq(userSubscriptions.stripeSubscriptionId, subscription.id)
                );

            console.log("Subscription updated in the database successfully");
        }
    } catch (error) {
        console.error("Database operation error", error);
        return new NextResponse("Database error", { status: 500 });
    }

    return new NextResponse(null, { status: 200 });
}

// Ensure that only POST requests are allowed
export async function GET() {
    return new NextResponse("Method Not Allowed", { status: 405 });
}
