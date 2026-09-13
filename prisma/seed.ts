import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CHANNELS = [
  { slug: "the-yard", name: "The Yard", tagline: "Everything goes — general poppin'" },
  { slug: "east-side", name: "East Side", tagline: "Where the real ones link up" },
  { slug: "tag-wall", name: "Tag Wall", tagline: "Graffiti, art & ink — leave your mark" },
  { slug: "lowrider-lounge", name: "Lowrider Lounge", tagline: "Slow rides & smooth talk" },
  { slug: "smoke-signals", name: "Smoke Signals", tagline: "Late night confessions" },
];

const WELCOME: Record<string, { author: string; content: string }[]> = {
  "the-yard": [
    { author: "El Ghost", content: "yard's open... pull up and speak on it." },
    { author: "Sad Girl", content: "first rule of the yard — keep it a hundred." },
  ],
  "east-side": [
    { author: "Crafty", content: "east side strong as ever, homies." },
  ],
  "tag-wall": [
    { author: "Ink Fiend", content: "fresh piece dropped... leave your tag below." },
  ],
  "lowrider-lounge": [
    { author: "Smiley", content: "hydraulics tuned, low & slow tonight." },
  ],
  "smoke-signals": [
    { author: "Blu", content: "who else up past the witching hour?" },
  ],
};

async function main() {
  for (const ch of CHANNELS) {
    const channel = await db.channel.upsert({
      where: { slug: ch.slug },
      update: { name: ch.name, tagline: ch.tagline },
      create: { slug: ch.slug, name: ch.name, tagline: ch.tagline },
    });

    const existing = await db.message.count({ where: { channelId: channel.id } });
    if (existing === 0) {
      const seed = WELCOME[ch.slug] ?? [];
      for (let i = 0; i < seed.length; i++) {
        await db.message.create({
          data: {
            content: seed[i].content,
            author: seed[i].author,
            channelId: channel.id,
            createdAt: new Date(Date.now() - (seed.length - i) * 1000 * 60 * 30),
          },
        });
      }
    }
  }
  console.log("Seeded channels:", CHANNELS.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
