import { createProxy } from "highseat/next"

const proxy = createProxy({ clientIp: "vercel" })

export { proxy as GET, proxy as POST }
