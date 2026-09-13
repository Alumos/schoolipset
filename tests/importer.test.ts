import XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseXlsx } from '../src/server/importer';
import { parsePrefix, sameSubnet } from '../src/server/utils';

describe('network value helpers', () => {
  it('converts dotted subnet masks and checks a gateway subnet', () => {
    expect(parsePrefix('255.255.255.0')).toBe(24);
    expect(parsePrefix('/24')).toBe(24);
    expect(sameSubnet('10.168.160.11', '10.168.160.254', 24)).toBe(true);
    expect(sameSubnet('10.168.160.11', '10.168.161.254', 24)).toBe(false);
  });
});

describe('xlsx import preview', () => {
  it('detects the second-row headers used by the school workbook', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['夏驾河小学教师办公计算机固定网络IP分配'],
      ['序号', '教职工', 'IP地址', '子网掩码', '网关', 'DNS', '地点'],
      ['1', '赵 斌', '10.168.160.13', '255.255.255.0', '10.168.160.254', '10.150.150.150', '行政楼'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const preview = parseXlsx(buffer, 'fixture.xlsx');
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ name: '赵 斌', ip: '10.168.160.13', prefix: 24, valid: true });
    expect(preview.rows[0].warnings).toContain('未填写网卡提示，客户端将按网卡策略自动选择');
  });
});
