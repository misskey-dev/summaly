// Tests decide private IP handling themselves; a value left in the developer's shell must not leak in.
delete process.env.CHIRAMISS_ALLOW_PRIVATE_IP;
delete process.env.SUMMALY_ALLOW_PRIVATE_IP;
