"use client"

import { useIdentify } from "highseat/next"

export function Identify() {
  useIdentify("user_fixture")
  return null
}
