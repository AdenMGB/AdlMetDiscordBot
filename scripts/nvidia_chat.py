#!/usr/bin/env python3
"""Quick local test for NVIDIA integrate API (DeepSeek). Requires: pip install openai"""

from __future__ import annotations

import os
import sys

from openai import OpenAI


def main() -> None:
	api_key = os.environ.get("NVIDIA_API_KEY")
	if not api_key:
		print("Set NVIDIA_API_KEY in the environment.", file=sys.stderr)
		sys.exit(1)

	client = OpenAI(
		base_url="https://integrate.api.nvidia.com/v1",
		api_key=api_key,
	)

	prompt = (
		" ".join(sys.argv[1:])
		if len(sys.argv) > 1
		else "Give one fun, accurate fact about Adelaide Metro trains."
	)

	completion = client.chat.completions.create(
		model="deepseek-ai/deepseek-v4.1-flash",
		messages=[{"role": "user", "content": prompt}],
		temperature=1,
		top_p=0.95,
		max_tokens=512,
		stream=True,
		extra_body={"chat_template_kwargs": {"enable_thinking": False}},
	)

	parts: list[str] = []
	for chunk in completion:
		delta = chunk.choices[0].delta.content if chunk.choices else None
		if delta:
			parts.append(delta)
	print("".join(parts))


if __name__ == "__main__":
	main()
