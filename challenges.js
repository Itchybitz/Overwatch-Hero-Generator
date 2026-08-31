// ── Overwatch Slots — challenge pool ─────────────────────────
// Dares dealt out alongside heroes when the Challenges toggle is on.
// player: anyone, any hero · role.*: tied to the role's job
// hero: keyed by the exact hero name in heroes.js · team: whole-squad dares
// Keep each one a single sentence, second person, playable in a real match.

const CHALLENGES = {
  player: [
    "Hit an emote after every elimination, no matter how dangerous the situation is.",
    "Deliver all your callouts in your best impression of your hero's voice.",
    "Narrate each of your deaths in an excited sports commentator voice.",
    "Refer to the payload only as the child for the entire match.",
    "Announce your ult with a different hero's ult voice line each time.",
    "If you get booped off the map, perform a slow fading scream into the mic.",
    "Give a weather forecast for the map, like slight chance of Junkrat, before each fight.",
    "Address teammates only by their hero's full government name, like Mr. Reinhardt Wilhelm.",
    "Crouch-spam a polite bow at the first enemy you meet each round before fighting them.",
    "Thank your healer with a full Oscar acceptance speech any time you survive under 20 HP.",
    "Take a different route out of spawn after every single death.",
    "During any 1v1 you may only strafe left, like a crab with an agenda.",
    "Cross every sniper sightline in a serpentine pattern.",
    "Do a full 360 spin before activating your ultimate.",
    "Use your ultimate the moment it hits 100 percent, unless a team dare says otherwise.",
    "Ride the payload facing backwards so nothing can ever sneak up on you.",
    "High ground is lava this match: take every fight from street level.",
    "Crouch-hop through every doorway like you expect a Junkrat trap.",
    "Your movement ability is for escaping only; walk into fights like everyone else.",
    "If your hero reloads, reload after every elimination like an action hero.",
    "Never turn your back on the enemy; all retreats happen walking backwards.",
    "Main is closed for renovations: reach every fight through a flank route.",
    "Jump immediately every time you hear an enemy ultimate voice line.",
    "Mega health packs are for the weak; you may only use minis.",
    "Spray the wall where you die every time, leaving a memorial trail across the map.",
    "Refer to yourself only in the third person by your hero's name for the whole match.",
    "Answer every question in voice chat with a hero voice line instead of a real answer.",
  ],
  role: {
    tank: [
      "Roar into voice chat every single time you land in the middle of the enemy team.",
      "Formally apologize to your supports every time you wander out of healing range.",
      "Give your health bar a name and provide emotional status updates on it all match.",
      "Be first through every choke; if a teammate beats you in, apologize in voice.",
      "Your ultimate may only start fights, never save them.",
      "All tactical retreats must happen at crouch speed to preserve tank dignity.",
      "Announce every defensive cooldown you use like a limited-time infomercial deal.",
    ],
    damage: [
      "Declare every elimination was calculated, especially the ones that clearly were not.",
      "Announce your flank route in full detail over voice, then act betrayed when it fails.",
      "Rate each of your final blows out of ten in the voice of a bored competition judge.",
      "Gasp theatrically into the mic whenever the enemy support heals your target.",
      "Pick one enemy per fight and shoot only them until one of you dies.",
      "Never shoot from the same angle as your tank; find an off-angle every fight.",
      "After every elimination you must relocate before firing again.",
      "Barriers are load-bearing walls; you are not allowed to shoot them.",
    ],
    support: [
      "Use your best disappointed school nurse voice whenever a teammate dives in alone.",
      "Whisper an ominous you are welcome into voice chat after every clutch save.",
      "Open every teamfight by damaging an enemy before you heal anyone.",
      "Teammates who spam the need healing line get moved to the back of the queue.",
      "Never stand still while healing; strafe like your life depends on it, because it does.",
      "Sigh a teammate's full gamer tag slowly in voice chat whenever they die out of range.",
      "Confirm every heal like a drive-thru order taker in voice chat.",
    ],
  },
  hero: {
    "Reinhardt": [
      "Bellow a full knightly war cry into voice chat every time you press Charge.",
      "Narrate your shield's remaining health like a medieval town crier all match.",
      "Challenge any enemy Reinhardt to a hammers-only duel whenever your paths cross.",
    ],
    "Winston": [
      "Use your calmest scientist voice for callouts until Primal Rage, then scream everything.",
      "Politely say excuse me in voice chat every time you leap into the enemy backline.",
    ],
    "Roadhog": [
      "Personally apologize over voice to every single person you hook, mid-fight.",
      "Do a big satisfied exhale into the mic every time you finish Take a Breather.",
    ],
    "D.Va": [
      "Thank your sponsors out loud every time you call down a fresh mech.",
      "Say nerf this out loud for every self-destruct, no matter how hopeless the placement.",
    ],
    "Wrecking Ball": [
      "Every grapple must include at least one full circle before you let go.",
      "Provide your own hamster squeaks in voice chat every time you grapple.",
      "Yell incoming delivery before every piledriver you attempt.",
    ],
    "Doomfist": [
      "Enter every teamfight from the sky with Seismic Slam or do not enter at all.",
      "Rocket Punch must always aim an enemy at a wall; open-field punches are banned.",
    ],
    "Junker Queen": [
      "Commentate every knife throw like a carnival act, whether it lands or whiffs.",
      "Deliver a one-line campaign speech for Junkertown every time you use Commanding Shout.",
    ],
    "Sigma": [
      "Deliver one line of unsettling physics wisdom every time you use Gravitic Flux.",
      "Hum a little tune into the mic every time your rock knocks someone down.",
    ],
    "Zarya": [
      "Announce your energy percentage like a stock ticker after every bubble.",
      "Tell the team how much you can bench every time your energy hits maximum.",
    ],
    "D.Mon": [
      "Refer to your mech as she at all times and apologize to her personally whenever you get hit.",
      "Give your team a formal MEKA mission briefing before every round like Busan depends on it.",
    ],
    "Domina": [
      "Address your teammates only as loyal subjects for the entire match.",
      "Whenever you die, calmly explain that you permitted the enemy to do that.",
    ],
    "Hazard": [
      "Give a delighted punk rock oi in voice chat every time Violent Leap connects.",
      "Admire your Jagged Wall out loud like street art every time you place it.",
    ],
    "Mauga": [
      "Refer to your chainguns only as Gunny and Cha-Cha for the entire match.",
      "Announce your Cage Fight like a wrestling ring announcer, even when you trap nobody.",
    ],
    "Orisa": [
      "Formally apologize by hero name to every enemy you javelin off the map.",
      "Make the helicopter noise out loud for the full duration of every Javelin Spin.",
    ],
    "Ramattra": [
      "Use a serene monk voice in Omnic form and a furious villain growl in Nemesis form.",
      "Share one bleak philosophical observation every time you toss Ravenous Vortex.",
    ],
    "Genji": [
      "Enter every fight from above; wall climb your way to each engagement.",
      "Solemnly request healing exactly once per minute whether you need it or not.",
      "Whisper mada mada in deep disappointment whenever Dragonblade ends with zero kills.",
    ],
    "Tracer": [
      "Pulse Bomb must always be stuck to a person, never thrown at the ground.",
      "Announce that the cavalry is here every single time you leave spawn.",
      "Apologize in a chipper British accent whenever Recall undoes an enemy's hard work.",
    ],
    "Junkrat": [
      "Cackle audibly in voice chat whenever your tire gets a kill or explodes trying.",
      "Celebrate every trap kill you earn while dead like it was your master plan all along.",
    ],
    "Widowmaker": [
      "Say no one can hide from my sight in a French accent after every scoped kill.",
      "Sigh with elegant boredom in voice chat every time you miss a fully charged shot.",
    ],
    "Cassidy": [
      "Announce the actual real-world time in a cowboy drawl every time you use Deadeye.",
      "Call your combat roll tactical tumbleweed in voice chat every time you use it.",
    ],
    "Hanzo": [
      "Claim every lucky arrow was precisely as planned, no matter how obvious the spray.",
      "Deliver one piece of samurai wisdom to the team after every elimination.",
    ],
    "Mei": [
      "Apologize cheerfully every time your ice wall inconveniences your own team.",
      "Wave at every enemy caught in your Blizzard before doing anything else.",
    ],
    "Sombra": [
      "Whisper boop into the mic every time you hack anything, including health packs.",
      "Insist nobody saw you every time you escape on low HP with translocator.",
    ],
    "Torbjörn": [
      "Compliment your turret out loud, by name, every time it earns an elimination.",
      "Yell more where that came from in a Swedish accent with every Molten Core.",
    ],
    "Bastion": [
      "Respond to every callout aimed at you with your best robot beeping.",
      "Sit in exactly one new scenic spot per fight and call it redecorating.",
    ],
    "Reaper": [
      "Whisper death comes into the mic every time you teleport behind the enemy team.",
      "Declare the shadows called you every time you Wraith Form out at low HP.",
    ],
    "Pharah": [
      "Yell justice rains from above for every barrage, even completely empty ones.",
      "Apologize to gravity every time you are forced to land during a fight.",
    ],
    "Symmetra": [
      "Thank each turret for its service, out loud, as it gets destroyed.",
      "Announce the true purpose of every teleporter you place, however mundane.",
    ],
    "Anran": [
      "Narrate every retreat with the phrase Anran saw the danger and ran.",
      "Deliver all your callouts in a serene meditation-app voice no matter how bad things get.",
    ],
    "Ashe": [
      "Yell BOB, do something in your best drawl every single time you send him in.",
      "Deliver Bob a one-line performance review in voice chat when his ult ends.",
    ],
    "Echo": [
      "Cheerfully announce I am you now, but better every time you Duplicate an enemy.",
      "Hum your own dramatic flying music out loud for the full duration of every Flight.",
    ],
    "Emre": [
      "Correct anyone who says the name Emre with a different pronunciation each time.",
      "Spell out E M R E in a game-show voice every time you win a duel.",
    ],
    "Freja": [
      "Declare a bounty on one enemy each fight and announce the reward money in voice chat.",
      "Say target locked in your gravest bounty hunter voice before every Take Aim shot.",
    ],
    "Shion": [
      "After every miss, solemnly whisper Shion never misses into voice chat.",
      "Respond to any thanks from teammates with only the words shine on.",
    ],
    "Sierra": [
      "Make every callout in NATO phonetic style and begin each one with Sierra reporting.",
      "Confirm every plan your team makes with a crisp copy that, Sierra out.",
    ],
    "Sojourn": [
      "Apologize like a true Canadian every time you whiff a fully charged railgun shot.",
      "Say the floor is lava whenever you land Disruptor Shot on a choke.",
    ],
    "Soldier: 76": [
      "Mutter about your back like a tired dad every time you drop a biotic field.",
      "Say back in my day we aimed manually every single time you press Tactical Visor.",
    ],
    "Vendetta": [
      "Declare a dramatic personal vendetta against one enemy player and renew it every round.",
      "Watch every killcam in silence, then quietly say noted before respawning.",
    ],
    "Venture": [
      "Announce going down like an elevator operator every single time you burrow.",
      "Share one enthusiastic rock or dirt fact in voice chat after every elimination.",
    ],
    "Mercy": [
      "Say heroes never die slightly more menacingly with every Resurrection you pull off.",
      "Walking is a last resort; travel by Guardian Angel whenever a teammate is in range.",
      "Refer to your pocketed damage player only as my patient for the entire match.",
    ],
    "Lúcio": [
      "Cross every open area by wall ride; flat ground is for other supports.",
      "Shout environmental and make air-horn noises for every boop, successful or not.",
      "Yell drop the beat and pause one full beat before every Sound Barrier.",
    ],
    "Zenyatta": [
      "Say ohm with steadily rising panic each time an enemy gets close to you.",
      "Respond to every death with serene meditation wisdom and absolutely no anger.",
      "Announce you are experiencing tranquility every time you kick someone off the map.",
    ],
    "Kiriko": [
      "Make a small fox noise in voice chat every time you teleport through a wall.",
      "Thank the fox out loud every single time you use Kitsune Rush.",
    ],
    "Ana": [
      "Say good night in your softest grandma voice every time you land a sleep dart.",
      "Publicly shame whoever wakes up your slept target, by name, every single time.",
    ],
    "Brigitte": [
      "Cheer for your flail like a proud sports parent every time Whip Shot lands.",
      "Yell shield bash with knightly conviction every single time you use it.",
    ],
    "Moira": [
      "Announce which hand you are using, constantly, like a boxing commentator.",
      "Call your damage orb the experiment and take zero responsibility for where it goes.",
    ],
    "Baptiste": [
      "Announce jump practice and hop on your Exo Boots the whole walk back from spawn.",
      "Call your Immortality Field the no dying zone and enforce it in voice chat.",
    ],
    "Illari": [
      "Deliver a short heartfelt eulogy in voice chat whenever your pylon gets destroyed.",
      "Announce sunrise like a nature documentary narrator every time you fire Captive Sun.",
    ],
    "Jetpack Cat": [
      "Meow to get your team's attention before every callout you make.",
      "Blame every mistake you make on a red dot that only you could see.",
    ],
    "Juno": [
      "Thank your passengers for flying Juno airlines every time teammates take your Hyper Ring.",
      "Make your own little pew pew sound for the whole lock-on of every Pulsar Torpedoes.",
    ],
    "Lifeweaver": [
      "Apologize with maximum elegance every time your Life Grip ruins a teammate's big play.",
      "Unveil every Tree of Life like a proud judge at a flower show announcing first prize.",
      "Ask if anyone ordered a lift in your fanciest voice before raising someone on Petal Platform.",
    ],
    "Mizuki": [
      "Thank each teammate by name in your gentlest customer-service voice whenever you save them.",
      "Welcome every teammate back from spawn like a spa receptionist greeting a loyal regular.",
    ],
    "Wuyang": [
      "Cheer the full name Wuyang with rising excitement every time your team wins a fight.",
      "Open every team fight by solemnly announcing that Wuyang has arrived.",
    ],
  },
  team: [
    "Everyone group-emotes together on the objective before the first fight of the match.",
    "The whole team sprays one spawn wall to create a mural before touching the point.",
    "The last player alive in each fight must narrate their survival documentary-style.",
    "Nobody may say enemy hero names; describe them, like the angry turret man, instead.",
    "After any full team wipe, observe a respectful moment of silence until you respawn.",
    "Start every round by walking out of spawn in single file behind the tank.",
    "Between fights, regroup at the nearest mega health pack like it is the office water cooler.",
    "After every team kill, the whole squad emotes on the spot before moving up.",
    "If the match hits overtime, everyone contests it crouched.",
    "Whenever your payload is moving, at least three of you must ride it like a parade float.",
    "Nobody may use their ultimate until the tank has used theirs first.",
    "Adopt one enemy as team mascot and cheer in voice chat whenever they get a kill.",
  ],
};
