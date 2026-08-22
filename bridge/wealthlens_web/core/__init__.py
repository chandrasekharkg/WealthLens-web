"""The framework-free read layer (ADR-0007).

Nothing in this package may import the web framework. Workspace resolution, lens access, family
aggregation, freshness and the job model all live here so they can be tested by calling a function —
no server, no request object, no HTTP (bridge-api: "A framework-free read layer, reusable by other
consumers"). The HTTP layer is a thin shell over this; an MCP server (ADR-0008) would be another.
"""
