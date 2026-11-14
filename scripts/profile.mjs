// Hand-written profile content for the generated cards. Edit this file to
// change the hero, the tech stack tiles or the experience timeline; the
// GitHub-derived cards need no editing.

export const HERO = {
  name: 'AYAAN',
  greeting: 'whoami',
  tagline: 'Writes code on Linux, plays on Windows.',
  role: 'Software Engineer at Adrosonic',
  focus: ['agentic workflows', 'LLM integration', 'applied cryptography', 'microservices'],
  // Cubes that orbit the name: [label, colour].
  orbit: [
    ['TS', '#3178c6'],
    ['Kt', '#a97bff'],
    ['Rs', '#dea584'],
    ['Py', '#3572a5'],
    ['C#', '#178600'],
    ['Go', '#00add8'],
  ],
};

export const STACK = [
  ['Languages', '#2997ff', ['TypeScript', 'Kotlin', 'Rust', 'Python', 'C#', 'Go', 'Java', 'SQL']],
  ['Backend', '#30d158', ['NestJS', 'Fastify', 'FastAPI', '.NET Core', 'Azure Functions', 'APIM', 'WebSockets', 'WebRTC']],
  ['Frontend + mobile', '#bf5af2', ['Next.js', 'React', 'Tailwind', 'Electron', 'Tauri', 'Jetpack Compose', 'Kotlin Multiplatform']],
  ['AI + agents', '#ff9f0a', ['Gemini', 'OpenAI', 'Claude', 'LangChain', 'Vercel AI SDK', 'MCP', 'n8n']],
  ['Data', '#ff375f', ['PostgreSQL', 'MongoDB', 'Redis', 'Prisma', 'Firebase', 'BullMQ']],
  ['Infrastructure', '#64d2ff', ['Docker', 'Nginx', 'Azure', 'GitHub Actions', 'pnpm + Turborepo']],
];

export const EXPERIENCE = [
  {
    period: 'Jun 2025 – Present',
    title: 'Software Engineer',
    org: 'Adrosonic',
    text: 'Own delivery on two live client projects in C#, .NET Core, Azure Functions and APIM.',
    color: '#30d158',
    current: true,
  },
  {
    period: 'Dec 2024 – Jun 2025',
    title: 'Software Engineer (Trainee)',
    org: 'Adrosonic',
    text: 'Built a Dynamics 365 + Instanda integration proof of concept that cut process automation time by 40%.',
    color: '#2997ff',
  },
  {
    period: 'Jul 2022 – Mar 2023',
    title: 'Android Developer Intern',
    org: 'BeyondSchool',
    text: 'Shipped text-to-speech and speech-to-text accessibility (+35% engagement) and gamification (+40% retention).',
    color: '#2997ff',
  },
  {
    period: '2023 – 2025',
    title: 'Master of Computer Applications',
    org: 'Birla Institute of Technology, Mesra',
    text: 'CGPA 8.1.',
    color: '#bf5af2',
  },
  {
    period: '2019 – 2022',
    title: 'Bachelor of Computer Applications',
    org: 'Birla Institute of Technology, Mesra',
    text: 'CGPA 8.2.',
    color: '#bf5af2',
  },
];
