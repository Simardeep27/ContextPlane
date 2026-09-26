# Minimum demo backlog

This backlog covers only the lowest-quality complete demonstration of this flow:

```text
Dev B publishes N+1 -> Context Plane records it -> Dev A works from N
-> pre-publish detects staleness -> exact combined candidate is tested
-> publication is authorized and receipted -> verified outcome becomes a
candidate policy -> the candidate is evaluated -> the approved policy becomes
Dev A's next personal-agent policy
```

The existing `@context-plane/contracts` and `@context-plane/persistence`
packages are foundations. They do not yet provide an API, workflow decisions,
agent loop, isolated runner, policy evolver, or demo surface.

## Issues and order

| ID | Major task | Depends on |
|---|---|---|
| [MVP-01 / #11](https://github.com/Simardeep27/ContextPlane/issues/11) | Align runtime contracts with persistence | Existing contracts and persistence |
| [MVP-02 / #12](https://github.com/Simardeep27/ContextPlane/issues/12) | Seed the deterministic Dev A / Dev B scenario | MVP-01 |
| [MVP-03 / #13](https://github.com/Simardeep27/ContextPlane/issues/13) | Build scoped context and publish-ingestion API | MVP-01, MVP-02 |
| [MVP-04 / #14](https://github.com/Simardeep27/ContextPlane/issues/14) | Implement stale-revision and publication state machine | MVP-01, MVP-02 |
| [MVP-05 / #15](https://github.com/Simardeep27/ContextPlane/issues/15) | Stage, test, and publish an exact candidate | MVP-01, MVP-04 |
| [MVP-06 / #16](https://github.com/Simardeep27/ContextPlane/issues/16) | Run and resume the durable agent workflow | MVP-01, MVP-03, MVP-04, MVP-05 |
| [MVP-07 / #17](https://github.com/Simardeep27/ContextPlane/issues/17) | Learn, evaluate, and promote a personal-agent policy | MVP-01, MVP-04, MVP-05 |
| [MVP-08 / #18](https://github.com/Simardeep27/ContextPlane/issues/18) | Add the minimum observable demo surface | MVP-03 through MVP-07 |
| [MVP-09 / #19](https://github.com/Simardeep27/ContextPlane/issues/19) | Prove the complete scenario and package evidence | All prior issues |

## Demo-wide non-goals

- Production multi-tenancy, billing, SSO, or real company data.
- Arbitrary repository execution or arbitrary shell commands.
- General-purpose policy generation or executable learned code.
- Vector search, broad retrieval, or long-term memory beyond this scenario.
- Pixel polish, mobile polish, or a general administration UI.
- Horizontal scaling or performance tuning beyond one demo worker.
