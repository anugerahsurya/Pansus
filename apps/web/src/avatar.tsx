import { UserRound } from 'lucide-react'

export function Avatar({ number, size = 40 }: { number?: number | null; size?: number }) {
  return <span className="profile-avatar" aria-hidden="true" style={{ width: size, height: size }}>
    {number ? <img src={`/avatars/${number}.webp`} alt="" width={size} height={size} /> : <UserRound size={Math.round(size * .5)} />}
  </span>
}
