import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

interface ServerInfo {
  hostname: string;
  publicIp: string;
}

export const getServersFromCSV = (): ServerInfo[] => {
  const csvPath = process.env.SERVERS_CSV_PATH || 'hosts.csv';
  
  try {
    const fileContent = readFileSync(csvPath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true
    });

    return records.map((record: any) => ({
      hostname: record.hostname,
      publicIp: record.public_ip
    }));
  } catch (error) {
    throw new Error(`Failed to read CSV file at ${csvPath}: ${error}`);
  }
} 